/** Currency + FX repository (MOD-08). All currency / fx_rate_daily SQL here. */
"use strict";
const { page } = require("../../../shared/db/query-helpers");

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

/** The tenant's base currency code, or null when none is flagged. */
async function getBaseCode(client) {
  const { rows } = await client.query("SELECT code FROM currency WHERE is_base = true LIMIT 1");
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
 * One statement so there is never a window with two bases or none. Only the rows
 * whose flag actually changes are touched.
 */
async function setBase(client, code) {
  const { rows } = await client.query(
    `UPDATE currency
        SET is_base    = (code = $1),
            is_active  = CASE WHEN code = $1 THEN true ELSE is_active END,
            updated_at = now()
      WHERE is_base <> (code = $1) OR code = $1
      RETURNING code, is_base, is_active`,
    [code],
  );
  return rows;
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

async function upsertRate(client, { base, quote, rate, asOfDate, source = "manual", isOverride = true }) {
  const { rows } = await client.query(
    "INSERT INTO fx_rate_daily (base_code, quote_code, rate, as_of_date, source, is_override) VALUES ($1,$2,$3,$4,$5,$6) " +
      "ON CONFLICT (base_code, quote_code, as_of_date, source) DO UPDATE SET rate = EXCLUDED.rate, is_override = EXCLUDED.is_override, fetched_at = now() RETURNING *",
    [base, quote, rate, asOfDate, source, isOverride],
  );
  return rows[0];
}

async function listRates(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
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
  const { rows } = await client.query("SELECT * FROM fx_rate_daily " + where + " ORDER BY as_of_date DESC LIMIT $1 OFFSET $2", params);
  return rows;
}

/** Rate rows for a pair over time (newest first) — the 360's history/sparkline. */
async function rateHistory(client, { base, quote, limit = 60 }) {
  const { rows } = await client.query(
    `SELECT rate, as_of_date::text AS as_of_date, source, is_override, fetched_at
       FROM fx_rate_daily
      WHERE base_code = $1 AND quote_code = $2
      ORDER BY as_of_date DESC, fetched_at DESC
      LIMIT $3`,
    [base, quote, limit],
  );
  return rows;
}

/** The manual-override history for a pair (who set what, when) — the audit log. */
async function overrideLog(client, { base, quote, limit = 25 }) {
  const { rows } = await client.query(
    `SELECT rate, as_of_date::text AS as_of_date, source, fetched_at
       FROM fx_rate_daily
      WHERE base_code = $1 AND quote_code = $2 AND is_override = true
      ORDER BY as_of_date DESC, fetched_at DESC
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
  upsertRate,
  listRates,
  rateHistory,
  overrideLog,
  lastSync,
};
