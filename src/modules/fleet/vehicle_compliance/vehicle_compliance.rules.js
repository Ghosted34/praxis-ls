/** Vehicle compliance pure rules (MOD-40) — expiry alert classification.
 *  Event keys live in vehicle_compliance.events (single source of truth). */
"use strict";

/** Alert level from days-left: LAPSED (<0), CRITICAL (≤7), WARN (≤30), OK. */
function alertLevel(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return "OK";
  if (daysLeft < 0) return "LAPSED";
  if (daysLeft <= 7) return "CRITICAL";
  if (daysLeft <= 30) return "WARN";
  return "OK";
}

module.exports = { alertLevel };
