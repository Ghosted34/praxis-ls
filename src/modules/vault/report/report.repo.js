/**
 * Reporting repository (MOD-63). Read-only rollups that aren't already owned by a
 * finance/costing module, plus saved-report and dashboard-tile persistence. All
 * SQL for this module lives here.
 */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

// ── Cross-module read rollups ──
/** Cash position: balance per class-5 treasury account (debit-positive). */
async function cashPosition(client, { entityId = null } = {}) {
  const params = [];
  const wh = ["je.status = 'validated'", "jl.account_code LIKE '5%'"];
  if (entityId) { params.push(entityId); wh.push("je.entity_id = $" + params.length); }
  const { rows } = await client.query(
    "SELECT jl.account_code, SUM(jl.debit - jl.credit) AS balance " +
      "FROM journal_line jl JOIN journal_entry je ON je.entry_id = jl.entry_id " +
      "WHERE " + wh.join(" AND ") + " GROUP BY jl.account_code ORDER BY jl.account_code",
    params,
  );
  const total = rows.reduce((s, r) => s + Number(r.balance), 0);
  return { accounts: rows.map((r) => ({ account_code: r.account_code, balance: Number(r.balance) })), total_cash: Math.round(total * 100) / 100 };
}

/** Procurement spend: PO + posted supplier-invoice totals, optionally by period. */
async function procurementSpend(client, { from = null, to = null } = {}) {
  const p1 = []; const w1 = ["status NOT IN ('DRAFT','CANCELLED')"];
  if (from) { p1.push(from); w1.push("created_at >= $" + p1.length); }
  if (to) { p1.push(to); w1.push("created_at <= $" + p1.length); }
  const po = (await client.query("SELECT COUNT(*)::int AS n, COALESCE(SUM(total_ttc),0) AS total FROM purchase_order WHERE " + w1.join(" AND "), p1)).rows[0];
  const p2 = []; const w2 = ["status = 'POSTED_LOCKED'"];
  if (from) { p2.push(from); w2.push("created_at >= $" + p2.length); }
  if (to) { p2.push(to); w2.push("created_at <= $" + p2.length); }
  const si = (await client.query("SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_ttc),0) AS total, COALESCE(SUM(wht_total),0) AS wht FROM supplier_invoice WHERE " + w2.join(" AND "), p2)).rows[0];
  return {
    purchase_orders: { count: po.n, total_ttc: Number(po.total) },
    supplier_invoices: { count: si.n, total_ttc: Number(si.total), wht_withheld: Number(si.wht) },
  };
}

/** Portfolio margin: billed vs actual cost per dossier (open + recent). */
async function dossierMarginPortfolio(client, { limit = 50 } = {}) {
  const { rows } = await client.query(
    "SELECT d.dossier_id, d.ref, d.status, " +
      "  COALESCE(inv.billed, 0) AS billed_ttc, COALESCE(ce.actual, 0) AS actual_cost, " +
      "  (COALESCE(inv.billed,0) - COALESCE(ce.actual,0)) AS gross_margin " +
      "FROM dossier d " +
      "LEFT JOIN (SELECT dossier_id, SUM(total_ttc) AS billed FROM invoice WHERE type='FINAL' AND status IN ('POSTED_LOCKED','APPROVED_LOCKED','ISSUED_LOCKED') GROUP BY dossier_id) inv ON inv.dossier_id = d.dossier_id " +
      "LEFT JOIN (SELECT dossier_id, SUM(amount) AS actual FROM cost_entry GROUP BY dossier_id) ce ON ce.dossier_id = d.dossier_id " +
      "ORDER BY d.created_at DESC LIMIT $1",
    [Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200)],
  );
  return rows.map((r) => ({
    dossier_id: r.dossier_id, ref: r.ref, status: r.status,
    billed_ttc: Number(r.billed_ttc), actual_cost: Number(r.actual_cost), gross_margin: Number(r.gross_margin),
    margin_percent: Number(r.billed_ttc) > 0 ? Math.round((Number(r.gross_margin) / Number(r.billed_ttc)) * 10000) / 100 : 0,
  }));
}

// ── Saved reports ──
const insertSaved = (client, data) => insertOne(client, "saved_report", data);
const getSaved = (client, id) => getById(client, "saved_report", "saved_report_id", id);
async function deleteSaved(client, id, userId) {
  const { rowCount } = await client.query("DELETE FROM saved_report WHERE saved_report_id = $1 AND owner_user_id = $2", [id, userId]);
  return rowCount > 0;
}
async function listSaved(client, { userId, limit, offset }) {
  const { limit: l, offset: o } = page({ limit, offset });
  const { rows } = await client.query(
    "SELECT * FROM saved_report WHERE is_shared = true OR owner_user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    [userId, l, o],
  );
  return rows;
}

// ── Dashboard tiles (per user) ──
async function listTiles(client, userId) {
  const { rows } = await client.query("SELECT * FROM dashboard_tile WHERE user_id = $1 ORDER BY position", [userId]);
  return rows;
}
async function upsertTile(client, { userId, tileKey, position = 0, isVisible = true, config = {} }) {
  const { rows } = await client.query(
    "INSERT INTO dashboard_tile (user_id, tile_key, position, is_visible, config) VALUES ($1,$2,$3,$4,$5::jsonb) " +
      "ON CONFLICT (user_id, tile_key) DO UPDATE SET position = EXCLUDED.position, is_visible = EXCLUDED.is_visible, config = EXCLUDED.config RETURNING *",
    [userId, tileKey, position, isVisible, JSON.stringify(config || {})],
  );
  return rows[0];
}

// ── Scheduled reports (1.3) — tenant-defined recurring runs ──
async function insertScheduled(client, d) {
  const { rows } = await client.query(
    "INSERT INTO scheduled_report (name, report_key, params, cadence, recipients, formats, active, next_run_at, created_by) " +
      "VALUES ($1,$2,$3::jsonb,$4,$5::text[],$6::text[],$7,$8,$9) RETURNING *",
    [d.name, d.report_key, JSON.stringify(d.params || {}), d.cadence,
      d.recipients || [], d.formats || ["pdf"], d.active !== false, d.next_run_at || null, d.created_by || null]);
  return rows[0];
}
const getScheduled = (client, id) => getById(client, "scheduled_report", "scheduled_report_id", id);
async function listScheduled(client, { limit, offset }) {
  const { limit: l, offset: o } = page({ limit, offset });
  const { rows } = await client.query("SELECT * FROM scheduled_report ORDER BY created_at DESC LIMIT $1 OFFSET $2", [l, o]);
  return rows;
}
async function updateScheduled(client, id, f) {
  const params = [id]; const sets = [];
  const push = (col, val, cast = "") => { params.push(val); sets.push(col + " = $" + params.length + cast); };
  if (f.name !== undefined) push("name", f.name);
  if (f.report_key !== undefined) push("report_key", f.report_key);
  if (f.params !== undefined) push("params", JSON.stringify(f.params), "::jsonb");
  if (f.cadence !== undefined) push("cadence", f.cadence);
  if (f.recipients !== undefined) push("recipients", f.recipients, "::text[]");
  if (f.formats !== undefined) push("formats", f.formats, "::text[]");
  if (f.active !== undefined) push("active", f.active);
  if (f.next_run_at !== undefined) push("next_run_at", f.next_run_at);
  if (!sets.length) return getScheduled(client, id);
  const { rows } = await client.query(
    "UPDATE scheduled_report SET " + sets.join(", ") + ", updated_at = now() WHERE scheduled_report_id = $1 RETURNING *", params);
  return rows[0] || null;
}
async function deleteScheduled(client, id) {
  const { rowCount } = await client.query("DELETE FROM scheduled_report WHERE scheduled_report_id = $1", [id]);
  return rowCount > 0;
}
async function listDueScheduled(client) {
  const { rows } = await client.query(
    "SELECT * FROM scheduled_report WHERE active AND next_run_at IS NOT NULL AND next_run_at <= now() ORDER BY next_run_at");
  return rows;
}
async function markScheduledRan(client, id, nextRunAt) {
  const { rows } = await client.query(
    "UPDATE scheduled_report SET last_run_at = now(), next_run_at = $2, updated_at = now() WHERE scheduled_report_id = $1 RETURNING *",
    [id, nextRunAt]);
  return rows[0] || null;
}

module.exports = {
  cashPosition, procurementSpend, dossierMarginPortfolio,
  insertSaved, getSaved, deleteSaved, listSaved, listTiles, upsertTile,
  insertScheduled, getScheduled, listScheduled, updateScheduled, deleteScheduled,
  listDueScheduled, markScheduledRan,
};
