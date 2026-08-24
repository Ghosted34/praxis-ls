/**
 * The QES webhook, after the signature (doc/SIGNATURE_ENGINEERING_GUIDE.md
 * §7.4 step 5).
 *
 * The route owns what comes BEFORE the body is trusted — the limiter, the
 * raw text, the signature check. This file owns what happens after, and the
 * first thing it does is refuse to work on a body that has not been
 * verified, so the ordering cannot be rearranged by a future caller.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT A FAILURE LOOKS LIKE, AND WHY IT IS A 401 AND NOT A 500
 *
 * §7.6 criterion 4: "a webhook with a bad signature is rejected BEFORE the
 * body is parsed, and logs nothing from it". The response is 401 — the
 * provider's documented answer to "you are not who you claim to be" — and
 * the log line carries the IP and nothing from the body. A 500 would teach
 * the provider to retry a forged event; a 401 tells it the door is closed.
 * ══════════════════════════════════════════════════════════════════════════
 */
"use strict";

const qesService = require("../qes/qes.service");
const qes = require("../../../services/qes");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

/**
 * The provider's event type → the envelope state it means.
 *
 * `document_signed` maps to SENT, not COMPLETED, on purpose: it fires per
 * recipient, and with a single recipient "signed" and "completed" are one
 * moment apart — but the COMPLETED event is the one that says the document
 * is over, and the signature is written on that event, not on the halfway
 * one. A provider that sends signed-without-completed (a document with
 * conditional routing) is still on its way.
 */
const EVENT_STATUS = Object.freeze({
  document_completed: "COMPLETED",
  document_declined: "DECLINED",
  document_canceled: "CANCELLED",
  document_bounced: "FAILED",
  document_error: "FAILED",
  document_sent: "SENT",
  document_viewed: "SENT",
  document_in_progress: "SENT",
  document_signed: "SENT",
  // Everything else (created, recipients updated, sms outcomes) is the
  // provider's business, not the chain's.
});

/**
 * Verify, then process.
 *
 * `rawBody` is the RAW request text — the signature covers bytes, not a
 * re-serialised object, so the adapter sees exactly what arrived.
 */
async function handleWebhook(client, { provider, rawBody, headers, slug = null, tenantName = "" }) {
  const adapter = qes.resolveAdapter(provider);

  const secret = await qesService.webhookId(client);
  if (!secret) {
    // No webhook is registered for this tenant, so no event can be genuine.
    // 401, nothing logged: telling a caller "not configured" is a fact about
    // our internals, and the caller does not need it.
    throw new AppError("UNVERIFIED", "Unauthorized.", 401);
  }

  if (!adapter.verifyWebhook({ headers, rawBody, secret })) {
    throw new AppError("UNVERIFIED", "Unauthorized.", 401);
  }

  // Trusted from here. The shape is still the provider's, so parse defensively:
  // a verified event with a missing field is a provider bug, and it should
  // answer 200-and-ignore, not 500-and-retry-forever.
  let body;
  try {
    body = JSON.parse(String(rawBody || ""));
  } catch {
    return { ignored: true, reason: "verified but not JSON" };
  }

  const event = body && body.event;
  const object = body && body.data && body.data.object;
  const type = event && String(event.type || "");
  const providerRef = object && String(object.id || "");

  if (!EVENT_STATUS[type] || !providerRef) {
    return { ignored: true, reason: `no envelope state for event '${type || "none"}'` };
  }

  const out = await qesService.handleProviderEvent(client, {
    providerRef,
    providerStatus: EVENT_STATUS[type],
    source: "webhook",
    slug,
    tenantName,
  });

  // The related signer, if the event carries one — the certificate's
  // timeline benefits from the provider's own record of who signed.
  const related = event && event.related_signer;
  if (related && related.email && !out.ignored) {
    logger.debug(
      { envelope: out.envelope_id, event: type, related: related.email },
      "[qes] webhook event processed",
    );
  }

  return out;
}

module.exports = { handleWebhook, EVENT_STATUS };
