"use strict";

/**
 * Verification-portal events (10780).
 *
 * `document_signature.*`, not `signature.*`, for the reason 10774 recorded and
 * this module inherits: the mail programme owns the `signature.*` prefix for
 * EMAIL signatures. The prefix is also what shared/notifications/categories.js
 * keys on, so splitting the namespace would route half of one feature's events
 * to the wrong inbox bucket.
 *
 * MODULE stays MOD-66 — this module's own RBAC identity — while the events
 * carry MOD-64, because the people who should hear about a scan are the ones
 * who can see the signature it happened to.
 */
module.exports = {
  MODULE: "MOD-66",
  SIGNATURE_MODULE: "MOD-64",
  SCANNED_NEW_IP: "document_signature.scanned_new_ip",
  SCAN_ANOMALY: "document_signature.scan_anomaly",
  SCANNED: "document_signature.scanned",
};
