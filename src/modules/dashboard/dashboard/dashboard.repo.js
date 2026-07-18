"use strict";
/** Role-filtered KPI counts. Each count is guarded so a missing table/feature
 *  never breaks the dashboard. */
async function count(client, sql) {
  try { const { rows } = await client.query(sql); return Number(rows[0].n); } catch { return null; }
}
/** Like count() but preserves SQL NULL (→ null) instead of coercing to 0, so a
 *  "no data measured yet" metric can be distinguished from a genuine zero and
 *  hidden by the dashboard rather than shown as 0. */
async function num(client, sql) {
  try { const { rows } = await client.query(sql); const v = rows[0] && rows[0].n; return v === null || v === undefined ? null : Number(v); } catch { return null; }
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
    // Headline tiles (Control Tower). Each is guarded → null on a missing
    // table/feature so the card hides instead of breaking the payload.
    //  - revenue: sum of locked FINAL invoices (TTC). Mixed-currency is summed
    //    nominally — a rough headline figure, not an FX-consolidated total.
    //  - fleet: active vs total vehicles (fleet feature may be off → null/0).
    //  - SLA: on-time delivery rate = dossiers whose ATA ≤ ETA, over those with
    //    both dates set. null when nothing measurable yet (NULLIF guard).
    revenue_final_ttc: await num(client, "SELECT COALESCE(SUM(total_ttc), 0) n FROM invoice WHERE type='FINAL' AND status IN ('ISSUED_LOCKED','APPROVED_LOCKED','POSTED_LOCKED')"),
    revenue_currency: "XAF",
    fleet_total: await count(client, "SELECT count(*) n FROM vehicle"),
    fleet_active: await count(client, "SELECT count(*) n FROM vehicle WHERE status='ACTIVE'"),
    sla_on_time_pct: await num(client, "SELECT round(100.0 * count(*) FILTER (WHERE ata <= eta) / NULLIF(count(*) FILTER (WHERE ata IS NOT NULL AND eta IS NOT NULL), 0)) n FROM dossier"),
  };
}
/** Control Tower aggregate — the data the home screen shows: operation-file
 *  counts, the live-shipment list (open/in-progress dossiers), and how many
 *  approvals are waiting. Each query is guarded so a missing table/feature
 *  degrades to a zero/empty value instead of breaking the whole payload. */
async function controlTower(client) {
  const rows = async (sql) => {
    try { const r = await client.query(sql); return r.rows; } catch { return []; }
  };
  const one = async (sql) => (await rows(sql))[0] || {};

  const ops = await one(
    "SELECT COUNT(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS'))::int AS active, " +
      "COUNT(*) FILTER (WHERE status='OPEN')::int AS open, " +
      "COUNT(*) FILTER (WHERE status='IN_PROGRESS')::int AS in_progress " +
      "FROM dossier",
  );
  const shipments = await rows(
    "SELECT ref, status, pol AS origin, pod AS destination, vessel_flight, eta " +
      "FROM dossier WHERE status IN ('OPEN','IN_PROGRESS') " +
      "ORDER BY eta NULLS LAST, created_at DESC LIMIT 10",
  );
  const appr = await one("SELECT COUNT(*)::int AS awaiting FROM approval_task WHERE status = 'PENDING'");

  return {
    operation_files: { active: ops.active || 0, open: ops.open || 0, in_progress: ops.in_progress || 0 },
    approvals_awaiting: appr.awaiting || 0,
    live_shipments: shipments.map((s) => ({
      ref: s.ref, status: s.status, origin: s.origin || null, destination: s.destination || null,
      vessel_flight: s.vessel_flight || null, eta: s.eta || null,
    })),
  };
}

module.exports = { kpis, controlTower };
