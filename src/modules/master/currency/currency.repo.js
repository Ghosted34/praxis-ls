/** Currency + FX repository (MOD-08). All currency / fx_rate_daily SQL here. */
"use strict";
const { page } = require("../../../shared/db/query-helpers");

async function listCurrencies(client) {
  const { rows } = await client.query("SELECT * FROM currency WHERE is_active = true ORDER BY is_base DESC, code");
  return rows;
}

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
  const params = [limit, offset]; const wh = [];
  if (q.base) { params.push(q.base); wh.push("base_code = $" + params.length); }
  if (q.quote) { params.push(q.quote); wh.push("quote_code = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM fx_rate_daily " + where + " ORDER BY as_of_date DESC LIMIT $1 OFFSET $2", params);
  return rows;
}

module.exports = { listCurrencies, ratesForPair, upsertRate, listRates };
