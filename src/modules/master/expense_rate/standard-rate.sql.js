/**
 * THE STANDARD RATE — the one place an item's own price is read from.
 *
 * An item's "default price" used to be two things: a `dictionary_item
 * .default_price` column the dictionary form wrote, and the expense-rate row
 * with no carrier and no container type that the Expense Rates screen wrote.
 * Nothing kept them in step, so a rate set on Expense Rates showed 0 on the
 * dictionary overview and never reached a hand-picked costing line (meeting 5,
 * 21 Sep 2026, 01:01:49 — "the default price does not sync").
 *
 * Since 14120 the expense rate is the ONLY source: the column is backfilled
 * into a rate and never written again. Every read that used to select
 * `di.default_price` joins this fragment instead and exposes the result under
 * the same name, so a consumer does not need to know where it came from.
 *
 * "Standard" = scoped to no carrier (`rate_provider_id IS NULL`) and no
 * container type (`container_type_ref_id IS NULL`), in force today. It is the
 * bottom of `expense_rate.rules.pickRate`'s cascade, so this and the resolver
 * cannot disagree about which row is the item's own price.
 *
 * Usage: `FROM dictionary_item di ${standardRateJoin("di")}` then select
 * `sr.rate`, `sr.currency`, `sr.effective_from`, `sr.expense_rate_id`.
 */
"use strict";

/** @param {string} alias the dictionary_item alias in the outer query */
function standardRateJoin(alias = "di") {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error("standardRateJoin: bad alias");
  return `LEFT JOIN LATERAL (
      SELECT er.expense_rate_id, er.rate, er.currency, er.effective_from
        FROM expense_rate er
       WHERE er.dictionary_item_id = ${alias}.dictionary_item_id
         AND er.rate_provider_id IS NULL
         AND er.container_type_ref_id IS NULL
         AND er.effective_from <= CURRENT_DATE
         AND (er.effective_to IS NULL OR er.effective_to >= CURRENT_DATE)
       ORDER BY er.effective_from DESC, er.created_at DESC
       LIMIT 1
    ) sr ON true`;
}

/** The columns every caller selects, aliased so a row reads the same everywhere. */
const STANDARD_RATE_COLUMNS =
  "sr.rate AS default_price, sr.currency AS default_price_currency, " +
  "sr.effective_from AS default_price_from, sr.expense_rate_id AS default_price_rate_id";

module.exports = { standardRateJoin, STANDARD_RATE_COLUMNS };
