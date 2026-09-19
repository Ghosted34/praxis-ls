/**
 * AI action manifest (AI_ARCHITECTURE §2) for mail deliverability (MOD-70).
 *
 * "Why is our mail going to spam" is a question with a real, checkable answer —
 * SPF, DKIM, DMARC, the PTR record and the blocklists — and the module that
 * knows it had no manifest, so the assistant could only speculate.
 *
 * READ-ONLY, deliberately. `checkOne`/`checkAll` re-run the live DNS and
 * blocklist probes, and they take no actor — `domain_health_check` records a
 * verdict and a timestamp, nothing about who asked. Wiring them as writes would
 * mean a wrapper forwarding an `actor` the service has no parameter for: it
 * would satisfy the write-contract gate and record nothing, which is the shape
 * of problem that gate exists to catch. Re-running the sweep stays the button
 * it is in the mail settings screen until the service can attribute it.
 *
 * Both HTTP routes are additionally behind `requireFeature("mail.deliverability")`.
 * A manifest carries RBAC, not plan entitlement — the same split every other
 * mail action lives with (see `mail/mail.ai.js`); the feature gate is enforced
 * where it always was.
 */
"use strict";

const service = require("./deliverability.service");
const validator = require("./deliverability.validator");

const MOD = "MOD-70";

module.exports = {
  entity: "mail_deliverability",
  module_key: MOD,
  screens: [],

  reads: [
    { key: "deliverability_dashboard", service: (c) => service.dashboard(c), permission: { module: MOD, action: "view" }, describe: "The latest deliverability verdict per sending domain — SPF, DKIM, DMARC, PTR and blocklist state." },
    { key: "deliverability_history", service: (c, p) => service.history(c, p.domain, {}), permission: { module: MOD, action: "view" }, describe: "The check history for one sending domain — when each record last passed or failed." },
    { key: "check_delivery_route", service: (c, p) => service.checkDeliveryRoute(c, p.domain, {}), permission: { module: MOD, action: "view" }, describe: "Whether mail to one RECIPIENT domain can actually be delivered from here." },
  ],

  writes: [],
};
