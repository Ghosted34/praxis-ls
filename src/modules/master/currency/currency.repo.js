/** Currency + FX repository (MOD-08). All currency / fx_rate_daily SQL here. */
"use strict";
const { page, TOTAL_COL, splitTotal } = require("../../../shared/db/query-helpers");
const { AppError } = require("../../../utils/errors");

/* ── Currency master ──────────────────────────────────────────────────────── */

/** Active currencies only — the set FX quotes and dropdowns draw from. */
async function listCurrencies(client) {
  const { rows } = await client.query("SELECT * FROM currency WHERE is_active = true ORDER BY is_base DESC, code");
  return rows;
}

/** Just the active currency codes (fx-sync uses these as the quote set). */
async function listActiveCodes(client) {
  const { rows } = await client.query("SELECT code FROM currency WHERE is_active = true ORDER BY code");
  return rows.map((r) => r.code);
}

/**
 * The tenant's base currency code, or null when none is flagged.
 *
 * FAILS LOUDLY on a corrupt multiple-base state instead of silently returning
 * whichever row Postgres handed back first (the old `LIMIT 1`). Migration 13951
 * repairs legacy drift and adds a partial unique index so two bases cannot exist
 * going forward, but a tenant that has not yet taken 13951 could still be in the
 * broken state — and resolving FX against an arbitrary base is exactly the silent
 * corruption the audit (#7) flagged. Zero bases is a valid, expected state
 * (a bare tenant mid-seed) and returns null; TWO OR MORE is not, and throws.
 */
async function getBaseCode(client) {
  const { rows } = await client.query(
    "SELECT code FROM currency WHERE is_base = true ORDER BY code",
  );
  if (rows.length > 1) {
    throw new AppError(
      "BASE_CURRENCY_CORRUPT",
      "More than one base currency is flagged (" +
        rows.map((r) => r.code).join(", ") +
        "). Apply migration 13951 or set the base again to repair before FX can resolve.",
      500,
    );
  }
  return rows[0] ? rows[0].code : null;
}

/** One currency row by code, or null. */
async function getCurrency(client, code) {
  const { rows } = await client.query("SELECT * FROM currency WHERE code = $1", [code]);
  return rows[0] || null;
}

/**
 * The Currencies-page list. `all` includes deactivated rows (so they can be
 * re-activated); `usage` attaches a per-currency reference count and flags the
 * most-used one. Usage is opt-in because it scans every referencing table, and
 * the currency dropdowns that also hit this endpoint do not need it.
 */
async function listCurrenciesRich(client, { all = false, usage = false } = {}) {
  const where = all ? "" : "WHERE is_active = true";
  const { rows } = await client.query(`SELECT * FROM currency ${where} ORDER BY is_base DESC, code`);
  if (!usage) return rows;
  const counts = await usageCounts(client);
  const maxN = Math.max(0, ...Object.values(counts));
  return rows.map((r) => ({
    ...r,
    usage_count: counts[r.code] || 0,
    most_used: maxN > 0 && (counts[r.code] || 0) === maxN,
  }));
}

/**
 * Add (or re-activate) a currency from the ISO-4217 catalogue. Re-adding a
 * previously deactivated code turns it back on and refreshes its metadata to the
 * catalogue values, which is the intent of "add it again".
 */
async function insertCurrency(client, { code, name, symbol, decimals = 2 }) {
  const { rows } = await client.query(
    `INSERT INTO currency (code, name, symbol, decimals, is_active, updated_at)
     VALUES ($1, $2, $3, $4, true, now())
     ON CONFLICT (code) DO UPDATE
       SET is_active = true, name = EXCLUDED.name, symbol = EXCLUDED.symbol,
           decimals = EXCLUDED.decimals, updated_at = now()
     RETURNING *`,
    [code, name, symbol || null, decimals],
  );
  return rows[0];
}

/** Patch editable fields (name/symbol/decimals/is_active). Ignores unknown keys. */
async function updateCurrency(client, code, patch) {
  const sets = [];
  const params = [];
  for (const key of ["name", "symbol", "decimals", "is_active"]) {
    if (patch[key] !== undefined) {
      params.push(patch[key]);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (!sets.length) return getCurrency(client, code);
  sets.push("updated_at = now()");
  params.push(code);
  const { rows } = await client.query(
    `UPDATE currency SET ${sets.join(", ")} WHERE code = $${params.length} RETURNING *`,
    params,
  );
  return rows[0] || null;
}

/**
 * Make `code` the base currency: flip the old base off, this one on (and active).
 *
 * TWO ordered statements, not one. 13951's partial unique index
 * `ux_currency_single_base` is a plain (non-deferrable) index, so Postgres
 * checks it ROW BY ROW as an UPDATE walks the table — a single
 * `SET is_base = (code = $1)` flip is only safe when the planner happens to
 * visit the old base before the target. When it visits the target first
 * (typically rebasing BACK to a row that sorts earlier, e.g. XAF→EUR→XAF),
 * the target is flagged base while the old base still is → 23505
 * "duplicate key value violates unique constraint ux_currency_single_base"
 * and the base change is refused. Turning every other base off FIRST, then
 * the target on, can never collide regardless of row order.
 *
 * The caller (service.setBase) wraps this in one transaction, so there is no
 * observable window with two bases — or none: other sessions see the old base
 * until commit. The `WHERE is_base AND code <> $1` sweep also self-heals a
 * legacy multi-base drift, and the unique index remains the concurrency
 * backstop.
 */
async function setBase(client, code) {
  const off = await client.query(
    `UPDATE currency
        SET is_base = false, updated_at = now()
      WHERE is_base AND code <> $1
      RETURNING code, is_base, is_active`,
    [code],
  );
  const on = await client.query(
    `UPDATE currency
        SET is_base = true, is_active = true, updated_at = now()
      WHERE code = $1
      RETURNING code, is_base, is_active`,
    [code],
  );
  return [...off.rows, ...on.rows];
}

/** Hard-delete a currency. FK violations (23503) surface to the caller as 409. */
async function deleteCurrency(client, code) {
  const { rows } = await client.query("DELETE FROM currency WHERE code = $1 RETURNING code", [code]);
  return rows[0] || null;
}

/* ── Usage (which currency is most used, and where) ───────────────────────── */

const TABLE_LABELS = {
  supplier_invoice: "Supplier invoices",
  final_invoice: "Final invoices",
  invoice: "Invoices",
  quotation: "Quotations",
  costing: "Costings",
  margin_simulation: "Margin simulations",
  extra_charge_simulation: "Extra-charge simulations",
  purchase_order: "Purchase orders",
  cash_request: "Cash requests",
  treasury_account: "Treasury accounts",
  tax_jurisdiction: "Tax jurisdictions",
  journal_line: "Journal lines",
  journal_entry: "Journal entries",
  debt: "Debts / financing",
  asset: "Assets",
  opportunity: "Opportunities",
  client_master: "Clients",
  supplier_master: "Suppliers",
  corporate_entity: "Corporate entities",
  expense_rate: "Expense rates",
};
const stripSchema = (t) => String(t).replace(/^.*\./, "").replace(/"/g, "");
const prettify = (t) => stripSchema(t).replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

/**
 * Every (table, column) that has a FOREIGN KEY to currency(code), read straight
 * from the catalog so it can never fall out of sync with the schema as tables
 * are added. `fx_rate_daily`'s base_code/quote_code are excluded — a rate row is
 * FX plumbing, not a currency being "used" by the business.
 */
async function fkCurrencyColumns(client) {
  const { rows } = await client.query(
    `SELECT con.conrelid::regclass::text AS tbl, att.attname AS col
       FROM pg_constraint con
       JOIN pg_attribute att
         ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
      WHERE con.contype = 'f'
        AND con.confrelid = 'currency'::regclass`,
  );
  return rows.filter((r) => stripSchema(r.tbl) !== "fx_rate_daily");
}

/** Map of code → total reference count across every business table. */
async function usageCounts(client) {
  const cols = await fkCurrencyColumns(client);
  if (!cols.length) return {};
  // tbl is a regclass-rendered identifier (already correctly quoted); col is a
  // catalog attname. Neither is user input.
  const parts = cols.map(
    ({ tbl, col }) => `SELECT "${col}"::text AS code, count(*)::int AS n FROM ${tbl} WHERE "${col}" IS NOT NULL GROUP BY 1`,
  );
  const { rows } = await client.query(
    `SELECT code, SUM(n)::int AS n FROM (${parts.join(" UNION ALL ")}) u GROUP BY code`,
  );
  const map = {};
  for (const r of rows) map[r.code] = Number(r.n);
  return map;
}

/** Per-table breakdown of where one currency is used, biggest first. */
async function usageForCode(client, code) {
  const cols = await fkCurrencyColumns(client);
  if (!cols.length) return [];
  const parts = cols.map(
    ({ tbl, col }) => `SELECT '${stripSchema(tbl)}' AS tbl, count(*)::int AS n FROM ${tbl} WHERE "${col}" = $1`,
  );
  const { rows } = await client.query(parts.join(" UNION ALL "), [code]);
  const byTbl = new Map();
  for (const r of rows) byTbl.set(r.tbl, (byTbl.get(r.tbl) || 0) + Number(r.n));
  return [...byTbl.entries()]
    .filter(([, n]) => n > 0)
    .map(([tbl, n]) => ({ table: tbl, label: TABLE_LABELS[tbl] || prettify(tbl), count: n }))
    .sort((a, b) => b.count - a.count);
}

/* ── FX rates ─────────────────────────────────────────────────────────────── */

/** All rate rows for a pair on/before a date (resolver filters in JS). */
async function ratesForPair(client, base, quote, date) {
  const { rows } = await client.query(
    "SELECT base_code, quote_code, rate, as_of_date::text AS as_of_date, source, is_override " +
      "FROM fx_rate_daily WHERE base_code = $1 AND quote_code = $2 AND as_of_date <= $3::date ORDER BY as_of_date DESC",
    [base, quote, date],
  );
  return rows;
}

/**
 * The latest WORKING rate for every quote against `base`, as of today —
 * one row per quote, newest first, an override winning over a feed on the same
 * date. This is the cross-rate table a base REBASE reads: to make NEW the base
 * we need every current OLD→quote and OLD→NEW so we can derive NEW→quote and
 * NEW→OLD. DISTINCT ON collapses each quote to its single current rate, which
 * is exactly what "the current working rate for each pair" means.
 */
async function latestRatesFromBase(client, base) {
  const { rows } = await client.query(
    `SELECT DISTINCT ON (quote_code)
            quote_code, rate, as_of_date::text AS as_of_date, source, is_override
       FROM fx_rate_daily
      WHERE base_code = $1 AND as_of_date <= CURRENT_DATE
      ORDER BY quote_code, as_of_date DESC, is_override DESC, fetched_at DESC`,
    [base],
  );
  return rows;
}

async function upsertRate(client, { base, quote, rate, asOfDate, source = "manual", isOverride = true, setByUserId = null }) {
  const { rows } = await client.query(
    "INSERT INTO fx_rate_daily (base_code, quote_code, rate, as_of_date, source, is_override, set_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) " +
      "ON CONFLICT (base_code, quote_code, as_of_date, source) DO UPDATE SET rate = EXCLUDED.rate, is_override = EXCLUDED.is_override, set_by_user_id = EXCLUDED.set_by_user_id, fetched_at = now() RETURNING *",
    [base, quote, rate, asOfDate, source, isOverride, setByUserId],
  );
  return rows[0];
}

/**
 * The generic paged rate list. Shares the Gate-0 rate-history contract with
 * {@link rateHistory}: server-capped `limit`, `offset`, a real `total`, and the
 * deterministic ordering `as_of_date DESC, fetched_at DESC, fx_rate_id DESC` so
 * two rows on the same date never swap places between pages. Returns
 * `{ rows, total, limit, offset }`; the controller shapes `has_more`.
 */
async function listRates(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [];
  const wh = [];
  if (q.base) {
    params.push(q.base);
    wh.push("base_code = $" + params.length);
  }
  if (q.quote) {
    params.push(q.quote);
    wh.push("quote_code = $" + params.length);
  }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  params.push(limit, offset);
  const { rows } = await client.query(
    `SELECT f.*, u.full_name AS set_by_name, ${TOTAL_COL}
       FROM fx_rate_daily f
       LEFT JOIN app_user u ON u.user_id = f.set_by_user_id
       ${where}
      ORDER BY f.as_of_date DESC, f.fetched_at DESC, f.fx_rate_id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const { rows: clean, total } = splitTotal(rows);
  return { rows: clean, total, limit, offset };
}

/**
 * Rate rows for a pair over time (newest first) — the 360's history/sparkline.
 *
 * Gate-0 rate-history contract: capped `limit` + `offset`, a real window-function
 * `total`, deterministic ordering `as_of_date DESC, fetched_at DESC, fx_rate_id
 * DESC`, and the manual-override actor name joined in (audit #9 — "who set it").
 * Returns `{ rows, total, limit, offset }` so the dossier/UI can page.
 */
async function rateHistory(client, { base, quote, limit = 50, offset = 0 }) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const off = Math.max(parseInt(offset, 10) || 0, 0);
  const { rows } = await client.query(
    `SELECT f.rate, f.as_of_date::text AS as_of_date, f.source, f.is_override,
            f.fetched_at, f.set_by_user_id, u.full_name AS set_by_name, ${TOTAL_COL}
       FROM fx_rate_daily f
       LEFT JOIN app_user u ON u.user_id = f.set_by_user_id
      WHERE f.base_code = $1 AND f.quote_code = $2
      ORDER BY f.as_of_date DESC, f.fetched_at DESC, f.fx_rate_id DESC
      LIMIT $3 OFFSET $4`,
    [base, quote, lim, off],
  );
  const { rows: clean, total } = splitTotal(rows);
  return { rows: clean, total, limit: lim, offset: off };
}

/** The manual-override history for a pair (who set what, when) — the audit log. */
async function overrideLog(client, { base, quote, limit = 25 }) {
  const { rows } = await client.query(
    `SELECT f.rate, f.as_of_date::text AS as_of_date, f.source, f.fetched_at,
            f.set_by_user_id, u.full_name AS set_by_name
       FROM fx_rate_daily f
       LEFT JOIN app_user u ON u.user_id = f.set_by_user_id
      WHERE f.base_code = $1 AND f.quote_code = $2 AND f.is_override = true
      ORDER BY f.as_of_date DESC, f.fetched_at DESC, f.fx_rate_id DESC
      LIMIT $3`,
    [base, quote, limit],
  );
  return rows;
}

/** The most recent FEED (non-override) row for a pair — last-synced marker. */
async function lastSync(client, { base, quote }) {
  const { rows } = await client.query(
    `SELECT rate, as_of_date::text AS as_of_date, source, fetched_at
       FROM fx_rate_daily
      WHERE base_code = $1 AND quote_code = $2 AND is_override = false
      ORDER BY fetched_at DESC
      LIMIT 1`,
    [base, quote],
  );
  return rows[0] || null;
}

/* ── FX sync-run log (operational visibility — audit #6) ──────────────────── */

/** Open a sync-run row and return its id, so the outcome can be stamped later. */
async function startSyncRun(client, { base = null, trigger = "manual", actorUserId = null } = {}) {
  const { rows } = await client.query(
    `INSERT INTO fx_sync_run (base_code, trigger, actor_user_id, status)
     VALUES ($1, $2, $3, 'ok') RETURNING fx_sync_run_id`,
    [base, trigger, actorUserId],
  );
  return rows[0].fx_sync_run_id;
}

/** Stamp the outcome (status/counts/reason) and close the run. */
async function finishSyncRun(client, id, { status, updatedCount = 0, unsupported = [], reason = null, base = null } = {}) {
  await client.query(
    `UPDATE fx_sync_run
        SET status = $2, updated_count = $3, unsupported = $4, reason = $5,
            base_code = COALESCE($6, base_code), finished_at = now()
      WHERE fx_sync_run_id = $1`,
    [id, status, updatedCount, unsupported, reason, base],
  );
}

/** The most recent sync run (any trigger) — the master-page freshness banner. */
async function lastSyncRun(client) {
  const { rows } = await client.query(
    `SELECT fx_sync_run_id, base_code, trigger, status, updated_count,
            unsupported, reason, started_at, finished_at
       FROM fx_sync_run
      ORDER BY started_at DESC
      LIMIT 1`,
  );
  return rows[0] || null;
}

/** Recent sync runs for an operational history view. */
async function recentSyncRuns(client, limit = 10) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
  const { rows } = await client.query(
    `SELECT fx_sync_run_id, base_code, trigger, status, updated_count,
            unsupported, reason, started_at, finished_at
       FROM fx_sync_run
      ORDER BY started_at DESC
      LIMIT $1`,
    [lim],
  );
  return rows;
}

module.exports = {
  listCurrencies,
  listActiveCodes,
  getBaseCode,
  getCurrency,
  listCurrenciesRich,
  insertCurrency,
  updateCurrency,
  setBase,
  deleteCurrency,
  usageCounts,
  usageForCode,
  ratesForPair,
  latestRatesFromBase,
  upsertRate,
  listRates,
  rateHistory,
  overrideLog,
  lastSync,
  startSyncRun,
  finishSyncRun,
  lastSyncRun,
  recentSyncRuns,
};
