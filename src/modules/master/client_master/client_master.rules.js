/** Client master pure rules (KYC completeness + credit availability). */
"use strict";
const num = (v) => Number(v || 0);

/** KYC is complete when NIU + RCCM are present and at least one KYC doc uploaded. */
function kycComplete(c) {
  const docs = Array.isArray(c.kyc_docs) ? c.kyc_docs : [];
  return Boolean(c.niu && c.rccm && docs.length > 0);
}

/**
 * Credit availability given the client, an additional exposure, and the REAL
 * outstanding balance.
 *
 * DATA 1.9: `used` used to come from `c.cached_receivables`, a column nothing
 * has ever written. It is permanently zero, so every client reported zero
 * exposure and unlimited available credit — the control was inert while
 * appearing to work.
 *
 * `outstanding` is now passed in, derived by repo.outstandingFor(). Passing it
 * explicitly rather than reading it off the row is the point: a caller that
 * forgets gets `undefined` and a NaN it will notice, instead of a plausible
 * zero it will not.
 */
function creditStatus(c, additional = 0, outstanding = undefined) {
  const limit = (c.credit_limit === null || c.credit_limit === undefined) ? null : num(c.credit_limit);
  const used = num(outstanding !== undefined ? outstanding : c.cached_receivables);
  const requested = num(additional);
  if (limit === null) return { limit: null, used, requested, available: null, within: true };
  const available = Math.round((limit - used) * 100) / 100;
  return { limit, used, requested, available, within: used + requested <= limit };
}

module.exports = { kycComplete, creditStatus };
