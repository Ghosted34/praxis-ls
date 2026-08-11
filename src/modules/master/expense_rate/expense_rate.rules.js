/** Expense rate card (MOD-10) — pure resolver. Given a set of effective-dated
 *  rows for one dictionary item, pick the rate effective at a date, optionally
 *  scoped by a rate provider (carrier/authority) and a container type — most
 *  specific match wins, cascading down to the carrier's general rate and then
 *  the item's default. */
"use strict";
const { AppError } = require("../../../utils/errors");

function within(row, date) {
  const from = row.effective_from ? Date.parse(row.effective_from) : -Infinity;
  const to = row.effective_to ? Date.parse(row.effective_to) : Infinity;
  const d = Date.parse(date);
  return d >= from && d <= to;
}

/**
 * Cascade: (provider + container type) → (provider, any type) →
 * (any provider, container type) → (the item's plain default). A row that
 * NAMES a provider/type only applies when the request matches it — it is
 * never a fallback for a different provider — which is what keeps a Maersk
 * 40ft rate from silently answering an MSC 20ft request.
 */
function pickRate(rows, { date, rateProviderId = null, containerTypeRefId = null }) {
  const eff = rows.filter((r) => within(r, date));
  if (eff.length === 0) throw new AppError("NO_RATE", "no expense rate effective at " + date, 422);
  const eligible = eff.filter((r) =>
    (!r.rate_provider_id || r.rate_provider_id === rateProviderId) &&
    (!r.container_type_ref_id || r.container_type_ref_id === containerTypeRefId));
  if (eligible.length === 0) throw new AppError("NO_RATE_MATCH", "no expense rate matches the given provider/container type", 422);
  const score = (r) => (r.rate_provider_id ? 2 : 0) + (r.container_type_ref_id ? 1 : 0);
  eligible.sort((a, b) => score(b) - score(a) || Date.parse(b.effective_from) - Date.parse(a.effective_from));
  return eligible[0];
}

module.exports = { pickRate, within };
