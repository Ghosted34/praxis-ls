/**
 * Money columns for transaction-style exports.
 *
 * A transaction sheet states its amounts in the ROW's currency and the tenant
 * keeps books in its BASE currency — two different facts, so (when they
 * differ) two columns: `Original Amount · USD` and `Base Amount · XAF` (or
 * whatever repo.getBaseCode says — never an assumed code). The declaration is
 * the CALLER's choice via moneyColumns(); the builder never splits numeric
 * columns on its own, because guessing which number is money is how a qty
 * column ends up wearing a currency.
 *
 * Conversion goes through master/currency (MOD-08) — rateFor/convertAmount
 * resolved live from fx_rate_daily — NEVER a JavaScript rate table: a literal
 * is a second FX source that keeps quoting yesterday after the treasurer
 * changes a rate. This module exists so every export converts the same way.
 */
"use strict";

const currencyService = require("../../modules/master/currency/currency.service");
const currencyRepo = require("../../modules/master/currency/currency.repo");
const { pickLang } = require("./helpers");

/**
 * Declare the money column(s) for one amount.
 *
 * @param {string} header        Label for the original-amount column (the ISO
 *                               code is appended by the builder).
 * @param {Object} opts
 * @param {string} [opts.key="amount"]        Row key of the original amount.
 * @param {string} [opts.currency]            ISO code the amounts are stated in.
 * @param {string} [opts.base]                Tenant base code (context.baseCurrency).
 * @param {boolean} [opts.includeBase=true]   Emit the base companion column.
 * @param {string} [opts.baseKey]             Row key for the base amount
 *                                            (default `${key}_base` — the same
 *                                            key convertToBase writes).
 * @param {string} [opts.baseHeader]          Label override for the base column.
 * @param {string} [opts.language]            fr/en (default en) for that label.
 * @returns {import("./build").ColumnSpec[]}  One column when currency === base
 *                                            (duplicating the amount in two
 *                                            columns of the same unit is noise),
 *                                            two when they differ.
 */
function moneyColumns(header, { key = "amount", currency, base = null, includeBase = true, baseKey, baseHeader, language = "en" } = {}) {
  const code = currency ? String(currency).trim().toUpperCase() : null;
  const cols = [{ header, key, format: "money", currency: code || base || undefined }];
  // No companion when there is nothing to convert: same code as base (the
  // duplicated column is noise), or no code/base known at all.
  if (!includeBase || !base || !code || code === base) {
    return cols;
  }
  cols.push({
    header: baseHeader || pickLang("Montant en devise de base", "Base amount", language),
    key: baseKey || `${key}_base`,
    format: "money",
    // Fixed code, not "the base at render time": the header must name the
    // unit the numbers were converted INTO, and that is decided here.
    currency: base,
    isBaseAmount: true,
  });
  return cols;
}

/**
 * Fill each row's base-currency amount via MOD-08's convertAmount. Run inside
 * the caller's tenant connection (it queries fx_rate_daily).
 *
 * Rows whose currency equals the base pass through unchanged (identity — no
 * FX query for the unit the books are already in). A pair with NO rate on
 * file leaves the base cell EMPTY rather than failing the export: one
 * unpriced currency in a 400-row ledger must not cost the other 399 rows.
 * Amounts that are not finite numbers blank the cell for the same reason.
 *
 * @param {Object} client tenant DB client
 * @param {Object[]} rows row objects (mutated: baseKey filled in)
 * @param {Object} opts
 * @param {string} opts.amountKey      row key of the original amount
 * @param {string} [opts.currencyKey]  row key holding the ISO code (default "currency")
 * @param {string} [opts.dateKey]      row key of the transaction date (rate as-of)
 * @param {string} [opts.baseKey]      row key to write (default `${amountKey}_base`)
 * @param {string} [opts.base]         base code; resolved from MOD-08 when omitted
 */
async function convertToBase(client, rows, { amountKey, currencyKey = "currency", dateKey = null, baseKey, base = null } = {}) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  const target = base || (await currencyRepo.getBaseCode(client));
  const outKey = baseKey || `${amountKey}_base`;
  if (!target) {
    // No base flagged on the currency master: nothing honest to convert to.
    for (const row of rows) row[outKey] = null;
    return rows;
  }
  for (const row of rows) {
    // Number(null) is 0 — check emptiness BEFORE coercing, or a blank amount
    // converts to a real zero and burns an FX lookup on nothing.
    const raw = row[amountKey];
    const amount = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
    const code = String(row[currencyKey] || "").trim().toUpperCase();
    if (!code || !Number.isFinite(amount)) {
      row[outKey] = null;
      continue;
    }
    if (code === target) {
      row[outKey] = amount;
      continue;
    }
    try {
      const out = await currencyService.convertAmount(client, {
        amount,
        base: code,
        quote: target,
        ...(dateKey && row[dateKey] ? { date: row[dateKey] } : {}),
      });
      row[outKey] = out.converted;
    } catch {
      /* @silent:storage — no FX rate on file for that pair/day: an expected
         what-if state (a currency the tenant has not priced), not an export
         failure. Blank base cell; the original amount column stands. */
      row[outKey] = null;
    }
  }
  return rows;
}

module.exports = { moneyColumns, convertToBase };
