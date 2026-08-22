"use strict";

/**
 * Signing-chain events (10784).
 *
 * `document_signature.*`, not `signature.*`: the mail programme owns the
 * shorter prefix for EMAIL signatures (10768), and
 * shared/notifications/categories.js keys on the prefix — so a split namespace
 * would file half of one feature's events in the wrong inbox bucket. Same
 * decision 10774 and 10780 made.
 */
module.exports = {
  MODULE: "MOD-64",
  REQUESTED: "document_signature.requested",
  DISPATCHED: "document_signature.dispatched",
  VIEWED: "document_signature.viewed",
  DECLINED: "document_signature.declined",
  COMPLETED: "document_signature.completed",
  CERTIFICATE_ISSUED: "document_signature.certificate_issued",
  REMINDED: "document_signature.reminded",
  EXPIRED: "document_signature.expired",
  // Reused from 10774 — a chain's signatures are signatures like any other.
  SIGNED: "document_signature.signed",
  AMENDED: "document_signature.amended",
};
