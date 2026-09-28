/**
 * An invoice's supporting documents, shared with the client (14160) — SQL.
 *
 * The CANDIDATES are what the file's reconciliation holds: every document
 * uploaded against a reconciliation line (13801), with whether the cash
 * request ticked that line as owing a receipt. The tick is read the way the
 * reconciliation grid reads it — `bool_or` over live claims, the cash request
 * being SSOT for it (Q9) — so "suggested" here and "owes a receipt" there can
 * never disagree.
 */
"use strict";

/** A final invoice as staff see it — any status; publishing checks it. */
async function invoice(client, invoiceId) {
  const { rows } = await client.query(
    `SELECT i.invoice_id, i.doc_number, i.client_id, i.dossier_id, i.status, i.type,
            i.currency, i.total_ttc, d.ref AS dossier_ref,
            COALESCE(cm.name, cm.legal_name) AS client_name
       FROM invoice i
       LEFT JOIN dossier_visible d ON d.dossier_id = i.dossier_id
       LEFT JOIN client_master cm  ON cm.client_id = i.client_id
      WHERE i.invoice_id = $1 AND i.type = 'FINAL'`,
    [invoiceId],
  );
  return rows[0] || null;
}

/**
 * Every live document attached to the file's reconciliation lines, once each
 * (a receipt attached to two lines is one document), in the costing's own line
 * order so the client's list reads like the invoice.
 */
async function candidates(client, dossierId) {
  const { rows } = await client.query(
    `SELECT DISTINCT ON (d.doc_id)
            d.doc_id, d.note, d.uploaded_at,
            rl.costing_line_id, cl.line_no, cl.label AS line_label,
            v.original_name, v.storage_path, v.doc_type,
            COALESCE(just.justification_required, false) AS justification_required
       FROM dossier_reconciliation r
       JOIN dossier_reconciliation_line rl     ON rl.reconciliation_id = r.reconciliation_id
       JOIN dossier_reconciliation_document d  ON d.line_id = rl.line_id
       JOIN document_vault v                   ON v.doc_id = d.doc_id AND v.status <> 'ARCHIVED'
       LEFT JOIN costing_line cl               ON cl.costing_line_id = rl.costing_line_id
       LEFT JOIN LATERAL (
         SELECT bool_or(crl.justification_required) AS justification_required
           FROM cash_request_line crl
           JOIN cash_request cr ON cr.cash_request_id = crl.cash_request_id
          WHERE crl.costing_line_id = rl.costing_line_id
            AND cr.status <> 'REJECTED'
       ) just ON TRUE
      WHERE r.dossier_id = $1
      ORDER BY d.doc_id, cl.line_no NULLS LAST, d.uploaded_at`,
    [dossierId],
  );
  // DISTINCT ON needs doc_id first in the ORDER BY; the reading order is
  // restored here.
  return rows.sort(
    (a, b) =>
      (a.line_no ?? 1e9) - (b.line_no ?? 1e9) ||
      new Date(a.uploaded_at).getTime() - new Date(b.uploaded_at).getTime(),
  );
}

async function bundleFor(client, invoiceId) {
  const { rows: [bundle] } = await client.query(
    `SELECT b.*, u.full_name AS published_by_name
       FROM invoice_client_bundle b
       LEFT JOIN app_user u ON u.user_id = b.published_by
      WHERE b.invoice_id = $1`,
    [invoiceId],
  );
  if (!bundle) return null;
  const { rows: items } = await client.query(
    `SELECT it.doc_id, it.position, it.label, v.original_name, v.storage_path, v.doc_type
       FROM invoice_client_bundle_item it
       JOIN document_vault v ON v.doc_id = it.doc_id
      WHERE it.bundle_id = $1 AND v.status <> 'ARCHIVED'
      ORDER BY it.position`,
    [bundle.bundle_id],
  );
  return { ...bundle, items };
}

/** One bundle per invoice: publishing again replaces its contents. */
async function upsertBundle(client, { invoiceId, clientId, dossierId, publishedBy }) {
  const { rows } = await client.query(
    `INSERT INTO invoice_client_bundle (invoice_id, client_id, dossier_id, published_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (invoice_id) DO UPDATE
        SET published_at = now(), published_by = EXCLUDED.published_by,
            client_id = EXCLUDED.client_id, dossier_id = EXCLUDED.dossier_id
     RETURNING *`,
    [invoiceId, clientId, dossierId, publishedBy],
  );
  return rows[0];
}

async function replaceItems(client, bundleId, items) {
  await client.query("DELETE FROM invoice_client_bundle_item WHERE bundle_id = $1", [bundleId]);
  for (const it of items) {
    await client.query(
      "INSERT INTO invoice_client_bundle_item (bundle_id, doc_id, position, label) VALUES ($1, $2, $3, $4)",
      [bundleId, it.doc_id, it.position, it.label],
    );
  }
}

async function deleteBundle(client, invoiceId) {
  const { rowCount } = await client.query("DELETE FROM invoice_client_bundle WHERE invoice_id = $1", [invoiceId]);
  return rowCount > 0;
}

/**
 * The client's view of one bundle: only for their own invoice, and only once
 * it is issued — the same visibility rule every other portal invoice read uses.
 */
async function clientBundle(client, { clientId, invoiceId }) {
  const { rows: [owned] } = await client.query(
    `SELECT i.invoice_id FROM invoice i
      WHERE i.invoice_id = $1 AND i.client_id = $2 AND i.type = 'FINAL'
        AND i.status NOT IN ('DRAFT','SUBMITTED_FOR_VALIDATION','SUBMITTED_FOR_APPROVAL')`,
    [invoiceId, clientId],
  );
  if (!owned) return null;
  return bundleFor(client, invoiceId);
}

module.exports = { invoice, candidates, bundleFor, upsertBundle, replaceItems, deleteBundle, clientBundle };
