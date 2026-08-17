/** Portal repository. portal_access grants + a couple of client-scoped reads. */
"use strict";
const { insertOne, page } = require("../../shared/db/query-helpers");

const insertAccess = (client, data) => insertOne(client, "portal_access", data);
async function listAccess(client, { portal = null, limit = 50, offset = 0 } = {}) {
  const params = [limit, offset]; const wh = ["is_active = true"];
  if (portal) { params.push(portal); wh.push("portal = $" + params.length); }
  return (await client.query("SELECT * FROM portal_access WHERE " + wh.join(" AND ") + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params)).rows;
}
async function activeFor(client, email, portal) {
  const { rows } = await client.query(
    "SELECT * FROM portal_access WHERE subject_email = $1 AND portal = $2 AND is_active = true ORDER BY created_at DESC LIMIT 1",
    [email, portal],
  );
  return rows[0] || null;
}
async function revoke(client, id) {
  const { rows } = await client.query("UPDATE portal_access SET is_active = false WHERE portal_access_id = $1 AND is_active = true RETURNING *", [id]);
  return rows[0] || null;
}
// Client-portal scoped reads (a client only ever sees their own).
async function clientDossiers(client, clientId) {
  return (await client.query("SELECT dossier_id, ref, status, created_at FROM dossier_visible WHERE client_id = $1 ORDER BY created_at DESC LIMIT 100", [clientId])).rows;
}

// ── Client documents (PRD §11.1 "document vault — own docs") ────────────────
//
// A document is client-visible ONLY when its registry doc type carries
// `client_visible: true` (dictionary_ref.extra, seeded for BL/MAWB; a tenant
// adds more from the picker) AND the vault row is VERIFIED AND it belongs to
// this client — either filed against one of their dossiers or filed directly
// against the client (vault.client_id, 0669). Docs with a free-text doc_type
// and no registry reference are deliberately invisible: the registry decision
// is the thing that says "who a document is for", and nothing else is allowed
// to second-guess it.

const CLIENT_DOCUMENT_SELECT = `
  SELECT v.doc_id, v.doc_type, v.original_name, v.status, v.created_at,
         v.dossier_id, d.ref AS dossier_ref,
         dr.name_en, dr.name_fr, dr.code AS doc_type_code
    FROM document_vault v
    LEFT JOIN dossier_visible d ON d.dossier_id = v.dossier_id
    LEFT JOIN dictionary_ref dr ON dr.ref_id = v.doc_type_ref_id
   WHERE v.status = 'VERIFIED'
     AND dr.extra->>'client_visible' = 'true'
     AND ( (v.dossier_id IS NOT NULL AND d.client_id = $1)
        OR (v.client_id = $1) )`;

async function clientDocuments(client, clientId) {
  return (await client.query(
    `${CLIENT_DOCUMENT_SELECT} ORDER BY v.created_at DESC LIMIT 200`,
    [clientId],
  )).rows;
}

/** Ownership + visibility check for one document, or null. The download route
 *  goes through this so the bytes are served only when the doc is VERIFIED,
 *  client-visible by type, and the caller's client actually owns it. */
async function clientDocument(client, clientId, docId) {
  const { rows } = await client.query(
    `${CLIENT_DOCUMENT_SELECT} AND v.doc_id = $2 LIMIT 1`,
    [clientId, docId],
  );
  return rows[0] || null;
}
/**
 * The client-facing milestone chain for one of their dossiers, plus the
 * published assumptions the dates rest on.
 *
 * SCOPED TWICE, deliberately. The dossier must belong to THIS client, and only
 * `is_client_visible` stages and assumptions are returned — our invoicing and
 * internal handling stages are not a client's business, and the flag is set per
 * stage in the template editor. The three-date model collapses to ONE date
 * here: a client is shown the commitment, never our internal forecast, unless
 * the tenant has turned that on.
 */
async function clientDossierChain(client, { clientId, dossierId, showForecast = false }) {
  const owns = await client.query(
    "SELECT d.dossier_id, d.ref, d.status, d.service_type_id, st.name_fr AS service_fr, st.name_en AS service_en " +
      "  FROM dossier_visible d LEFT JOIN service_type st ON st.service_type_id = d.service_type_id " +
      " WHERE d.dossier_id = $1 AND d.client_id = $2",
    [dossierId, clientId],
  );
  const dossier = owns.rows[0];
  if (!dossier) return null;

  const stages = await client.query(
    "SELECT code, label, label_en, planned_due" +
      (showForecast ? ", forecast_due" : "") +
      ", status, completed_at, stage_seq " +
      "  FROM milestone_instance " +
      " WHERE dossier_id = $1 AND is_client_visible ORDER BY stage_seq",
    [dossierId],
  );

  const assumptions = dossier.service_type_id
    ? (await client.query(
        "SELECT code, text_fr, text_en FROM service_type_assumption " +
          " WHERE service_type_id = $1 AND is_client_visible ORDER BY seq, code",
        [dossier.service_type_id],
      )).rows
    : [];

  return { dossier, milestones: stages.rows, assumptions };
}

async function clientInvoices(client, clientId) {
  return (await client.query("SELECT invoice_id, doc_number, total_ttc, status, payment_due_on FROM invoice WHERE client_id = $1 AND type = 'FINAL' ORDER BY created_at DESC LIMIT 100", [clientId])).rows;
}

/**
 * Immutable-ledger read for the auditor room, whitelisted to financial/document
 * actions by their first dotted segment (`split_part(action,'.',1)`), so HR,
 * payroll, permission/role and God-Mode events can never leak into a third
 * party's view no matter what new event a module adds. The acting user IS named
 * (LEFT JOIN, so a null/unresolvable actor keeps the row) — "who posted/approved
 * this" is the audit trail an auditor legitimately needs. `to` is made inclusive
 * of the whole day. Bounded to a period; the ledger has no entity column, so
 * entity scoping applies to the statements, not the trail.
 */
async function auditLedger(client, { from, to, prefixes, limit = 500 }) {
  const { rows } = await client.query(
    `SELECT il.ledger_id, il.action, il.module_key, il.entity_ref, il.created_at,
            il.actor_user_id, u.full_name AS actor_name, u.email AS actor_email
       FROM immutable_ledger il
       LEFT JOIN app_user u ON u.user_id = il.actor_user_id
      WHERE il.created_at >= $1::date AND il.created_at < ($2::date + 1)
        AND split_part(il.action, '.', 1) = ANY($3::text[])
      ORDER BY il.created_at DESC
      LIMIT $4`,
    [from, to, prefixes, limit],
  );
  return rows;
}
module.exports = { insertAccess, listAccess, activeFor, revoke, clientDossiers, clientDossierChain, clientInvoices, auditLedger, page, clientDocuments, clientDocument };
