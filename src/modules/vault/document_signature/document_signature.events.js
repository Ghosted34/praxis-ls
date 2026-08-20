"use strict";

/**
 * Document-signature events.
 *
 * Namespaced `document_signature.*`, not `signature.*`: the mail programme owns
 * `signature.template.changed` / `.profile.changed` / `.cache.invalidated` for
 * EMAIL signatures — the sign-off block on an outgoing message. These are about
 * somebody attesting to an invoice. Sharing a prefix would make the event log
 * unreadable to whoever comes next.
 */
module.exports = {
  MODULE: "MOD-64",
  SIGNED: "document_signature.signed",
  REVOKED: "document_signature.revoked",
  AMENDED: "document_signature.amended",
  STALE: "document_signature.stale_detected",
};
