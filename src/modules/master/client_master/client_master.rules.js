/** Client master pure rules (KYC completeness + credit availability). */
"use strict";
const num = (v) => Number(v || 0);

/** KYC is complete when NIU + RCCM are present and at least one KYC doc uploaded. */
function kycComplete(c) {
  const docs = Array.isArray(c.kyc_docs) ? c.kyc_docs : [];
  return Boolean(c.niu && c.rccm && docs.length > 0);
}

/** Credit availability given the client and an additional exposure. */
function creditStatus(c, additional = 0) {
  const limit = (c.credit_limit === null || c.credit_limit === undefined) ? null : num(c.credit_limit);
  const used = num(c.cached_receivables);
  const requested = num(additional);
  if (limit === null) return { limit: null, used, requested, available: null, within: true };
  const available = Math.round((limit - used) * 100) / 100;
  return { limit, used, requested, available, within: used + requested <= limit };
}

module.exports = { kycComplete, creditStatus };
