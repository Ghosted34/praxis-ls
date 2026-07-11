/** Driver licence pure rules (MOD-44) — expiry alert classification. */
"use strict";

const ALERT_EVENT = "driver.license.expiring";

/** LAPSED (<0), CRITICAL (≤14 — licences need lead time), WARN (≤30), OK. */
function alertLevel(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return "OK";
  if (daysLeft < 0) return "LAPSED";
  if (daysLeft <= 14) return "CRITICAL";
  if (daysLeft <= 30) return "WARN";
  return "OK";
}

module.exports = { ALERT_EVENT, alertLevel };
