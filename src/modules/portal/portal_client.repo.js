/**
 * Client portal (redesign, PR 1) — the SQL behind the new client screens:
 * shipments feed, what we are waiting for from the client, billing balances,
 * proof of payment and the client's own team.
 *
 * EVERY READ IS SCOPED BY `client_id` IN SQL, and the client_id always comes
 * from the portal grant (controller `clientId(req)`), never from the request.
 * A guessed id for another client's file, invoice or request returns nothing,
 * which the service reports as NOT_FOUND — the same answer a missing row gets,
 * because "that exists but is not yours" is itself a disclosure.
 *
 * Operations files are read through `dossier_visible` (0671), never the base
 * table: a DRAFT the wizard is still filling in is not a client's shipment.
 */
"use strict";

/* ── identity ───────────────────────────────────────────────────────────── */

async function clientIdentity(client, clientId) {
  const { rows } = await client.query(
    "SELECT client_id, name, legal_name, preferred_language, entity_id FROM client_master WHERE client_id = $1",
    [clientId],
  );
  return rows[0] || null;
}

/* ── shipments ──────────────────────────────────────────────────────────── */

/**
 * One card per file: where it is (the first client-visible stage not DONE),
 * how far along (done of total), and when the next step is due. The stages are
 * the client-visible ones only (`is_client_visible`), the same filter the
 * shipment page applies, so the card and the page never disagree about "4 of 9".
 */
const SHIPMENT_CARD = `
  SELECT d.dossier_id, d.ref, d.title, d.status, d.created_at, d.eta, d.ata,
         d.pol, d.pod, d.bl_mawb, d.vessel_flight, d.incoterm,
         st.key AS service_key, st.name_en AS service_en, st.name_fr AS service_fr,
         COALESCE(p.total, 0) AS stages_total, COALESCE(p.done, 0) AS stages_done,
         p.current_label, p.current_label_en, p.current_status, p.next_due, p.last_done_at
    FROM dossier_visible d
    LEFT JOIN service_type st ON st.service_type_id = d.service_type_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE m.status = 'DONE')::int AS done,
             (array_agg(m.label ORDER BY m.stage_seq) FILTER (WHERE m.status <> 'DONE'))[1] AS current_label,
             (array_agg(m.label_en ORDER BY m.stage_seq) FILTER (WHERE m.status <> 'DONE'))[1] AS current_label_en,
             (array_agg(m.status ORDER BY m.stage_seq) FILTER (WHERE m.status <> 'DONE'))[1] AS current_status,
             min(m.planned_due) FILTER (WHERE m.status <> 'DONE') AS next_due,
             max(m.completed_at) AS last_done_at
        FROM milestone_instance m
       WHERE m.dossier_id = d.dossier_id AND m.is_client_visible
    ) p ON true
   WHERE d.client_id = $1`;

const STATE_FILTER = {
  active: "AND d.status IN ('OPEN','IN_PROGRESS')",
  done: "AND d.status IN ('COMPLETED','CANCELLED')",
  all: "",
};

async function shipments(client, clientId, { state = "all", limit = 200 } = {}) {
  const { rows } = await client.query(
    `${SHIPMENT_CARD} ${STATE_FILTER[state] || ""} ORDER BY d.created_at DESC LIMIT $2`,
    [clientId, limit],
  );
  return rows;
}

async function shipmentCard(client, clientId, dossierId) {
  const { rows } = await client.query(`${SHIPMENT_CARD} AND d.dossier_id = $2`, [clientId, dossierId]);
  return rows[0] || null;
}

/** The milestone ids the chain query does not return — a question raised about
 *  a stage is filed against its instance, so the ops team sees WHICH step. */
async function stageIds(client, dossierId) {
  const { rows } = await client.query(
    `SELECT milestone_instance_id, code, stage_seq
       FROM milestone_instance
      WHERE dossier_id = $1 AND is_client_visible
      ORDER BY stage_seq`,
    [dossierId],
  );
  return rows;
}

/* ── what we are waiting for (client_request, 14150) ────────────────────── */

/**
 * The document types that satisfy a requirement code. `BL_AWB` is the one
 * requirement code (10747) that the registry (0669) spells as two types.
 */
const SATISFIED_BY = `
  CASE WHEN w.doc_type_code = 'BL_AWB' THEN ARRAY['BL','MAWB','BL_AWB']
       ELSE ARRAY[w.doc_type_code] END`;

/**
 * Materialise the requirement rules as RULE requests for this client:
 *
 *   · client-level rules (GLOBAL, or CLIENT_TYPE matching the client's type),
 *   · file-level rules (GLOBAL, or SERVICE_TYPE matching the file's service
 *     type key or territory — 10747 seeds `IMPORT` / `EXPORT`) for every
 *     file still open,
 *
 * skipping any the vault already satisfies with a VERIFIED document. The
 * partial unique index makes this safe to run on every read.
 */
async function syncRuleRequests(client, clientId) {
  await client.query(
    `WITH cl AS (
       SELECT cm.client_id, ct.code AS client_type_code
         FROM client_master cm
         LEFT JOIN client_type ct ON ct.client_type_id = cm.client_type_id
        WHERE cm.client_id = $1
     ),
     wanted AS (
       SELECT r.doc_type_code, NULL::uuid AS dossier_id
         FROM document_requirement r CROSS JOIN cl
        WHERE r.is_active AND r.is_mandatory AND r.applies_to = 'CLIENT'
          AND (r.scope_kind = 'GLOBAL'
               OR (r.scope_kind = 'CLIENT_TYPE' AND r.scope_value = cl.client_type_code::text))
       UNION
       SELECT r.doc_type_code, d.dossier_id
         FROM dossier_visible d
         JOIN service_type st ON st.service_type_id = d.service_type_id
         JOIN document_requirement r
           ON r.is_active AND r.is_mandatory AND r.applies_to = 'DOSSIER'
          AND (r.scope_kind = 'GLOBAL'
               OR (r.scope_kind = 'SERVICE_TYPE'
                   AND (st.key::text = r.scope_value
                        OR st.key::text ILIKE '%' || r.scope_value || '%'
                        OR COALESCE(st.territory, '') ILIKE '%' || r.scope_value || '%')))
        WHERE d.client_id = $1 AND d.status IN ('OPEN','IN_PROGRESS')
     )
     INSERT INTO client_request (client_id, dossier_id, source, kind, doc_type_code, status)
     SELECT $1, w.dossier_id, 'RULE', 'DOCUMENT', w.doc_type_code, 'OPEN'
       FROM wanted w
      WHERE NOT EXISTS (
        SELECT 1
          FROM document_vault v
          JOIN dictionary_ref dr ON dr.ref_id = v.doc_type_ref_id AND dr.kind = 'DOCUMENT_TYPE'
         WHERE v.status = 'VERIFIED'
           AND dr.code::text = ANY (${SATISFIED_BY})
           AND ((w.dossier_id IS NULL AND v.client_id = $1)
                OR (w.dossier_id IS NOT NULL AND v.dossier_id = w.dossier_id))
      )
     ON CONFLICT DO NOTHING`,
    [clientId],
  );

  // A rule that staff satisfied some other way (filed the BL themselves) is
  // done — the client must not keep seeing "needed" for a paper we hold.
  await client.query(
    `UPDATE client_request w
        SET status = 'ACCEPTED', review_note = NULL
      WHERE w.client_id = $1 AND w.source = 'RULE' AND w.status IN ('OPEN','REJECTED')
        AND EXISTS (
          SELECT 1
            FROM document_vault v
            JOIN dictionary_ref dr ON dr.ref_id = v.doc_type_ref_id AND dr.kind = 'DOCUMENT_TYPE'
           WHERE v.status = 'VERIFIED'
             AND dr.code::text = ANY (${SATISFIED_BY})
             AND ((w.dossier_id IS NULL AND v.client_id = w.client_id)
                  OR (w.dossier_id IS NOT NULL AND v.dossier_id = w.dossier_id)))`,
    [clientId],
  );

  // A finished shipment no longer needs its paperwork chased.
  await client.query(
    `UPDATE client_request w
        SET status = 'CANCELLED'
      WHERE w.client_id = $1 AND w.source = 'RULE' AND w.status IN ('OPEN','REJECTED')
        AND w.dossier_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM dossier_visible d
           WHERE d.dossier_id = w.dossier_id AND d.status IN ('OPEN','IN_PROGRESS'))`,
    [clientId],
  );
}

const REQUEST_SELECT = `
  SELECT r.client_request_id, r.client_id, r.dossier_id, r.source, r.kind, r.doc_type_code,
         r.title, r.note, r.due_on, r.status, r.answer_text, r.answer_doc_id,
         r.answered_by_email, r.answered_at, r.review_note, r.reviewed_at, r.created_at, r.updated_at,
         d.ref AS dossier_ref,
         dr.name_en AS doc_type_en, dr.name_fr AS doc_type_fr,
         v.original_name AS answer_doc_name
    FROM client_request r
    LEFT JOIN dossier_visible d ON d.dossier_id = r.dossier_id
    LEFT JOIN dictionary_ref dr ON dr.kind = 'DOCUMENT_TYPE' AND dr.code::text = r.doc_type_code
    LEFT JOIN document_vault v ON v.doc_id = r.answer_doc_id`;

/** What the client sees, most urgent first: rejected (fix it), open, in review. */
async function clientRequests(client, clientId) {
  const { rows } = await client.query(
    `${REQUEST_SELECT}
      WHERE r.client_id = $1 AND r.status <> 'CANCELLED'
      ORDER BY CASE r.status WHEN 'REJECTED' THEN 0 WHEN 'OPEN' THEN 1 WHEN 'SUBMITTED' THEN 2 ELSE 3 END,
               r.due_on NULLS LAST, r.created_at DESC
      LIMIT 300`,
    [clientId],
  );
  return rows;
}

async function clientRequest(client, clientId, requestId) {
  const { rows } = await client.query(`${REQUEST_SELECT} WHERE r.client_id = $1 AND r.client_request_id = $2`, [clientId, requestId]);
  return rows[0] || null;
}

async function insertRequest(client, row) {
  const { rows } = await client.query(
    `INSERT INTO client_request (client_id, dossier_id, source, kind, doc_type_code, title, note, due_on, status,
                                 answer_text, answer_doc_id, answered_by_email, answered_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING client_request_id`,
    [
      row.client_id, row.dossier_id || null, row.source, row.kind, row.doc_type_code || null,
      row.title || null, row.note || null, row.due_on || null, row.status || "OPEN",
      row.answer_text || null, row.answer_doc_id || null, row.answered_by_email || null,
      row.answered_at || null, row.created_by || null,
    ],
  );
  return rows[0];
}

/** The client answered — a file, a sentence, or both. Clears a previous rejection. */
async function submitRequest(client, { requestId, clientId, docId = null, text = null, email }) {
  const { rows } = await client.query(
    `UPDATE client_request
        SET status = 'SUBMITTED',
            answer_doc_id = COALESCE($3, answer_doc_id),
            answer_text = COALESCE($4, answer_text),
            answered_by_email = $5, answered_at = now(), review_note = NULL
      WHERE client_request_id = $1 AND client_id = $2 AND status IN ('OPEN','REJECTED','SUBMITTED')
      RETURNING client_request_id, status`,
    [requestId, clientId, docId, text, email || null],
  );
  return rows[0] || null;
}

/* ── staff side of the same requests ────────────────────────────────────── */

async function staffRequests(client, { clientId = null, status = null, limit = 300 } = {}) {
  const { rows } = await client.query(
    `SELECT q.*, cm.name AS client_name
       FROM (${REQUEST_SELECT}
              WHERE ($1::uuid IS NULL OR r.client_id = $1)
                AND ($2::text IS NULL OR r.status = $2)
                AND r.status <> 'CANCELLED'
              ORDER BY CASE r.status WHEN 'SUBMITTED' THEN 0 WHEN 'OPEN' THEN 1 WHEN 'REJECTED' THEN 2 ELSE 3 END,
                       r.updated_at DESC
              LIMIT $3) q
       JOIN client_master cm ON cm.client_id = q.client_id`,
    [clientId, status, limit],
  );
  return rows;
}

async function requestById(client, requestId) {
  const { rows } = await client.query(`${REQUEST_SELECT} WHERE r.client_request_id = $1`, [requestId]);
  return rows[0] || null;
}

async function reviewRequest(client, { requestId, status, note, reviewedBy }) {
  const { rows } = await client.query(
    `UPDATE client_request
        SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now()
      WHERE client_request_id = $1
      RETURNING client_request_id, client_id, status, answer_doc_id`,
    [requestId, status, note || null, reviewedBy || null],
  );
  return rows[0] || null;
}

/** Accepted → the vault copy is VERIFIED; rejected → REJECTED. */
async function setVaultReview(client, { docId, status, verifiedBy }) {
  await client.query(
    "UPDATE document_vault SET status = $2, verified_by = $3 WHERE doc_id = $1",
    [docId, status, status === "VERIFIED" ? verifiedBy || null : null],
  );
}

async function archiveVaultDoc(client, docId) {
  await client.query("UPDATE document_vault SET status = 'ARCHIVED' WHERE doc_id = $1 AND status = 'PENDING'", [docId]);
}

/** The registry row a code names, for typed filing of an upload. */
async function documentType(client, code) {
  const { rows } = await client.query(
    "SELECT ref_id, code::text AS code, name_en, name_fr FROM dictionary_ref WHERE kind = 'DOCUMENT_TYPE' AND code = $1 AND is_active",
    [code],
  );
  return rows[0] || null;
}

/** The types a client may choose when sending something unasked. */
async function documentTypes(client) {
  const { rows } = await client.query(
    `SELECT code::text AS code, name_en, name_fr
       FROM dictionary_ref WHERE kind = 'DOCUMENT_TYPE' AND is_active AND code <> 'PAYMENT_PROOF'
      ORDER BY sort_order, name_en`,
  );
  return rows;
}

/** Whether a file is this client's, for anything filed against it. */
async function ownsDossier(client, clientId, dossierId) {
  const { rows } = await client.query(
    "SELECT d.dossier_id, st.key::text AS service_key FROM dossier_visible d LEFT JOIN service_type st ON st.service_type_id = d.service_type_id WHERE d.dossier_id = $1 AND d.client_id = $2",
    [dossierId, clientId],
  );
  return rows[0] || null;
}

async function vaultDoc(client, docId) {
  const { rows } = await client.query(
    "SELECT doc_id, original_name, status, storage_path, doc_type FROM document_vault WHERE doc_id = $1",
    [docId],
  );
  return rows[0] || null;
}

/* ── billing ────────────────────────────────────────────────────────────── */

/**
 * The client's issued invoices with what is left to pay. `allocated` is the
 * same figure the receivables ledger uses (`payment_allocation`), so the portal
 * balance and the ageing report cannot disagree; `in_review` is what the client
 * has told us they paid and finance has not yet confirmed.
 */
async function billingInvoices(client, clientId) {
  const { rows } = await client.query(
    `SELECT i.invoice_id, i.doc_number, i.status, i.currency, i.total_ttc, i.payment_due_on,
            i.created_at AS issued_on, i.dossier_id, i.entity_id, d.ref AS dossier_ref,
            COALESCE(a.allocated, 0) AS allocated,
            COALESCE(pp.in_review, 0) AS in_review
       FROM invoice i
       LEFT JOIN dossier_visible d ON d.dossier_id = i.dossier_id
       LEFT JOIN (SELECT invoice_id, SUM(amount) AS allocated FROM payment_allocation GROUP BY invoice_id) a
              ON a.invoice_id = i.invoice_id
       LEFT JOIN (SELECT pa.invoice_id, SUM(pa.amount) AS in_review
                    FROM payment_proof_allocation pa
                    JOIN payment_proof p ON p.payment_proof_id = pa.payment_proof_id
                   WHERE p.status = 'SUBMITTED'
                   GROUP BY pa.invoice_id) pp
              ON pp.invoice_id = i.invoice_id
      WHERE i.client_id = $1 AND i.type = 'FINAL'
        AND i.status NOT IN ('DRAFT','SUBMITTED_FOR_VALIDATION','SUBMITTED_FOR_APPROVAL')
      ORDER BY i.created_at DESC
      LIMIT 300`,
    [clientId],
  );
  return rows;
}

/** Invoices a proof may be allocated to: this client's, issued, not cancelled. */
async function payableInvoices(client, clientId, invoiceIds) {
  const { rows } = await client.query(
    `SELECT i.invoice_id, i.currency, i.total_ttc
       FROM invoice i
      WHERE i.client_id = $1 AND i.invoice_id = ANY($2::uuid[]) AND i.type = 'FINAL'
        AND i.status IN ('ISSUED_LOCKED','APPROVED_LOCKED','POSTED_LOCKED')`,
    [clientId, invoiceIds],
  );
  return rows;
}

async function invoiceEntity(client, clientId, invoiceId) {
  const { rows } = await client.query(
    `SELECT i.invoice_id, i.entity_id, i.doc_number, i.type, i.status
       FROM invoice i
      WHERE i.invoice_id = $1 AND i.client_id = $2 AND i.type = 'FINAL'
        AND i.status NOT IN ('DRAFT','SUBMITTED_FOR_VALIDATION','SUBMITTED_FOR_APPROVAL')`,
    [invoiceId, clientId],
  );
  return rows[0] || null;
}

/** The entity row and its treasury accounts, for the payment block. */
async function entityForPayment(client, entityId) {
  const [entity, accounts] = await Promise.all([
    client.query("SELECT * FROM corporate_entity WHERE entity_id = $1", [entityId]).then((r) => r.rows[0] || null),
    client.query("SELECT * FROM treasury_account WHERE entity_id = $1", [entityId]).then((r) => r.rows),
  ]);
  return { entity, accounts };
}

/** The vaulted PDF of an invoice, when one has been rendered. */
async function vaultByRef(client, entityRef) {
  const { rows } = await client.query(
    "SELECT doc_id, storage_path FROM document_vault WHERE entity_ref = $1 AND status <> 'ARCHIVED' ORDER BY updated_at DESC LIMIT 1",
    [entityRef],
  );
  return rows[0] || null;
}

/* ── proof of payment (14150) ───────────────────────────────────────────── */

/** The id is chosen by the caller so the receipt file can be filed under
 *  `payment_proof:<id>` before the row exists. */
async function insertProof(client, row) {
  const { rows } = await client.query(
    `INSERT INTO payment_proof (payment_proof_id, client_id, amount, currency, method, provider, paid_on,
                                reference, note, dossier_id, doc_id, submitted_by_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING payment_proof_id, status, created_at`,
    [
      row.payment_proof_id, row.client_id, row.amount, row.currency, row.method, row.provider || null,
      row.paid_on, row.reference || null, row.note || null, row.dossier_id || null, row.doc_id || null,
      row.submitted_by_email || null,
    ],
  );
  return rows[0];
}

async function setProofReceipt(client, proofId, receiptId) {
  await client.query("UPDATE payment_proof SET receipt_id = $2 WHERE payment_proof_id = $1", [proofId, receiptId]);
}

/** Undo a confirmation whose receipt could not be drafted, so it can be retried. */
async function reopenProof(client, proofId) {
  await client.query(
    "UPDATE payment_proof SET status = 'SUBMITTED', reviewed_by = NULL, reviewed_at = NULL WHERE payment_proof_id = $1",
    [proofId],
  );
}

async function insertProofAllocations(client, proofId, allocations) {
  if (!allocations.length) return;
  await client.query(
    `INSERT INTO payment_proof_allocation (payment_proof_id, invoice_id, amount)
     SELECT $1, x.invoice_id, x.amount
       FROM jsonb_to_recordset($2::jsonb) AS x(invoice_id uuid, amount numeric)`,
    [proofId, JSON.stringify(allocations)],
  );
}

const PROOF_SELECT = `
  SELECT p.payment_proof_id, p.client_id, p.amount, p.currency, p.method, p.provider, p.paid_on,
         p.reference, p.note, p.dossier_id, p.doc_id, p.status, p.submitted_by_email,
         p.review_note, p.reviewed_at, p.receipt_id, p.created_at,
         d.ref AS dossier_ref,
         COALESCE(
           json_agg(json_build_object('invoice_id', a.invoice_id, 'amount', a.amount, 'doc_number', i.doc_number)
                    ORDER BY i.doc_number) FILTER (WHERE a.invoice_id IS NOT NULL),
           '[]'::json) AS allocations
    FROM payment_proof p
    LEFT JOIN payment_proof_allocation a ON a.payment_proof_id = p.payment_proof_id
    LEFT JOIN invoice i ON i.invoice_id = a.invoice_id
    LEFT JOIN dossier_visible d ON d.dossier_id = p.dossier_id`;

async function clientProofs(client, clientId) {
  const { rows } = await client.query(
    `${PROOF_SELECT} WHERE p.client_id = $1 GROUP BY p.payment_proof_id, d.ref ORDER BY p.created_at DESC LIMIT 100`,
    [clientId],
  );
  return rows;
}

async function staffProofs(client, { status = null, clientId = null, limit = 200 } = {}) {
  const { rows } = await client.query(
    `SELECT q.*, cm.name AS client_name
       FROM (${PROOF_SELECT}
              WHERE ($1::text IS NULL OR p.status = $1) AND ($2::uuid IS NULL OR p.client_id = $2)
              GROUP BY p.payment_proof_id, d.ref
              ORDER BY p.created_at DESC
              LIMIT $3) q
       JOIN client_master cm ON cm.client_id = q.client_id`,
    [status, clientId, limit],
  );
  return rows;
}

async function proofById(client, proofId) {
  const { rows } = await client.query(`${PROOF_SELECT} WHERE p.payment_proof_id = $1 GROUP BY p.payment_proof_id, d.ref`, [proofId]);
  return rows[0] || null;
}

async function reviewProof(client, { proofId, status, note, reviewedBy, receiptId = null }) {
  const { rows } = await client.query(
    `UPDATE payment_proof
        SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now(), receipt_id = COALESCE($5, receipt_id)
      WHERE payment_proof_id = $1 AND status = 'SUBMITTED'
      RETURNING payment_proof_id, client_id, status, doc_id, receipt_id`,
    [proofId, status, note || null, reviewedBy || null, receiptId],
  );
  return rows[0] || null;
}

/* ── the client's team (portal_access, 14150) ──────────────────────────── */

async function teamGrants(client, clientId) {
  const { rows } = await client.query(
    `SELECT portal_access_id, subject_email::text AS email, access_scope, is_client_admin,
            invited_by_email::text AS invited_by_email, created_at, expires_at
       FROM portal_access
      WHERE portal = 'CLIENT' AND client_id = $1 AND is_active
      ORDER BY is_client_admin DESC, created_at`,
    [clientId],
  );
  return rows;
}

/** Any live CLIENT grant this email already holds, whichever client it is for. */
async function activeClientGrantFor(client, email) {
  const { rows } = await client.query(
    `SELECT portal_access_id, client_id FROM portal_access
      WHERE portal = 'CLIENT' AND subject_email = $1 AND is_active
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY created_at DESC LIMIT 1`,
    [email],
  );
  return rows[0] || null;
}

async function insertTeamGrant(client, { clientId, email, scope, isAdmin, invitedBy }) {
  const { rows } = await client.query(
    `INSERT INTO portal_access (portal, subject_email, client_id, access_scope, is_client_admin, invited_by_email)
     VALUES ('CLIENT', $1, $2, $3, $4, $5)
     RETURNING portal_access_id, subject_email::text AS email, access_scope, is_client_admin, created_at`,
    [email, clientId, scope, !!isAdmin, invitedBy || null],
  );
  return rows[0];
}

async function updateTeamGrant(client, { clientId, grantId, scope, isAdmin }) {
  const { rows } = await client.query(
    `UPDATE portal_access
        SET access_scope = COALESCE($3, access_scope),
            is_client_admin = COALESCE($4, is_client_admin)
      WHERE portal_access_id = $1 AND client_id = $2 AND portal = 'CLIENT' AND is_active
      RETURNING portal_access_id, subject_email::text AS email, access_scope, is_client_admin`,
    [grantId, clientId, scope || null, typeof isAdmin === "boolean" ? isAdmin : null],
  );
  return rows[0] || null;
}

async function removeTeamGrant(client, { clientId, grantId }) {
  const { rows } = await client.query(
    `UPDATE portal_access SET is_active = false
      WHERE portal_access_id = $1 AND client_id = $2 AND portal = 'CLIENT' AND is_active
      RETURNING portal_access_id, subject_email::text AS email`,
    [grantId, clientId],
  );
  return rows[0] || null;
}

async function countAdmins(client, clientId) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM portal_access
      WHERE portal = 'CLIENT' AND client_id = $1 AND is_active AND is_client_admin`,
    [clientId],
  );
  return rows[0] ? rows[0].n : 0;
}

module.exports = {
  clientIdentity,
  shipments, shipmentCard, stageIds,
  syncRuleRequests, clientRequests, clientRequest, insertRequest, submitRequest,
  staffRequests, requestById, reviewRequest, setVaultReview, archiveVaultDoc,
  documentType, documentTypes, ownsDossier, vaultDoc,
  billingInvoices, payableInvoices, invoiceEntity, entityForPayment, vaultByRef,
  insertProof, insertProofAllocations, clientProofs, staffProofs, proofById, reviewProof,
  setProofReceipt, reopenProof,
  teamGrants, activeClientGrantFor, insertTeamGrant, updateTeamGrant, removeTeamGrant, countAdmins,
};
