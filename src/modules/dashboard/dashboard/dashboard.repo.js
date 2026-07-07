"use strict";
/** Role-filtered KPI counts. Each count is guarded so a missing table/feature
 *  never breaks the dashboard. */
async function count(client, sql) {
  try { const { rows } = await client.query(sql); return Number(rows[0].n); } catch { return null; }
}
async function kpis(client) {
  return {
    open_dossiers: await count(client, "SELECT count(*) n FROM dossier WHERE status IN ('OPEN','IN_PROGRESS')"),
    proformas: await count(client, "SELECT count(*) n FROM invoice WHERE type='PROFORMA'"),
    final_invoices: await count(client, "SELECT count(*) n FROM invoice WHERE type='FINAL'"),
    receipts: await count(client, "SELECT count(*) n FROM payment_receipt"),
    clients: await count(client, "SELECT count(*) n FROM client_master WHERE is_active"),
    suppliers: await count(client, "SELECT count(*) n FROM supplier_master WHERE is_active"),
    open_compliance_flags: await count(client, "SELECT count(*) n FROM compliance_flag WHERE resolved_at IS NULL"),
    unposted_journal_entries: await count(client, "SELECT count(*) n FROM journal_entry WHERE status='draft'"),
  };
}
module.exports = { kpis };
