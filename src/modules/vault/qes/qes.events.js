/**
 * QES event keys (MOD-64) — doc/SIGNATURE_ENGINEERING_GUIDE.md §7.3.
 *
 * `qes.*`, not `document_signature.*`: the envelope is the provider's object
 * and its lifecycle is the provider's, so it carries its own prefix the way
 * the mail programme owns `signature.*` for email signatures (10768). The
 * act of signing stays `document_signature.signed` — the envelope events
 * say a document moved on the provider's side; the signature event says an
 * act happened in this system, and it is the one the certificate prints.
 */
"use strict";

module.exports = {
  MODULE: "MOD-64",
  ENVELOPE_CREATED: "qes.envelope_created",
  ENVELOPE_COMPLETED: "qes.envelope_completed",
  ENVELOPE_DECLINED: "qes.envelope_declined",
  ENVELOPE_FAILED: "qes.envelope_failed",
  QUOTA_LOW: "qes.quota_low",
};
