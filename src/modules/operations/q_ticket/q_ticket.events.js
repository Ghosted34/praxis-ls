"use strict";
/**
 * Client query tickets against a milestone (MOD-31).
 *
 * Rides MOD-31 rather than taking a key of its own: a Q ticket is always raised
 * against a milestone, and a module_key absent from platform.feature_catalogue
 * has grants for nobody — a new key would 403 every non-CEO user until the
 * catalogue was re-seeded. Same reasoning as service_type riding MOD-29.
 */
module.exports = {
  MODULE: "MOD-31",
  RAISED: "q_ticket.raised",
  REPLIED: "q_ticket.replied",
  RESOLVED: "q_ticket.resolved",
};
