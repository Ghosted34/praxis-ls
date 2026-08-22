/**
 * SignWell adapter — the only QES provider in V1 (Q14 = B).
 * doc/SIGNATURE_ENGINEERING_GUIDE.md §7.2, §7.4.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── THE WIRE FORMAT BELOW WAS VERIFIED AGAINST THE LIVE DOCUMENTATION ─────
 * The guide is specific that a guide which hardcodes a third party's request
 * shape from memory "sends someone to debug a 400 against the wrong
 * contract". Every path, header and field in this file was checked against
 * the SignWell developer reference (developers.signwell.com, updated
 * 2026-04-29 / 2026-07-27) at implementation time. If SignWell changes the
 * API, this file is the single place that must change — and the adapter
 * tests pin the request shape, so a drift that breaks creation or the
 * webhook check fails CI rather than a counterparty's signing session.
 *
 *   base            https://www.signwell.com/api/v1
 *   auth            header X-Api-Key (an apiKey security scheme — a bearer
 *                   token would send the key to the wrong place)
 *   create          POST /documents/  → 201 { id, status, recipients[] }
 *   get             GET  /documents/{id}
 *   signed pdf      GET  /documents/{id}/completed_pdf?file_format=pdf
 *                          &audit_page=false        → raw PDF bytes
 *   audit cert      GET  /documents/{id}/completed_pdf?file_format=pdf
 *                          &audit_page=true         → PDF with the provider's
 *                          Audit & Lock page appended
 *   cancel          DELETE /documents/{id}  (deleting also cancels in-flight
 *                          signing — that is the cancellation primitive)
 *   webhook register POST /hooks { callback_url } → { id }
 *   webhook list    GET /hooks
 *   probe           GET /me → { account: { name, plan_tier } }
 *
 * ── WEBHOOK VERIFICATION, AS DOCUMENTED ────────────────────────────────────
 * The production scheme is an HMAC over the EVENT, not the raw body:
 *
 *   key        the webhook id (returned when the webhook was registered)
 *   message    event.type + "@" + event.time
 *   signature  event.hash            (hex, HMAC-SHA256)
 *
 * Consequence for "verify before parsing": the signature's inputs live IN
 * the body, so the body must be read to obtain them — but nothing else in it
 * is trusted or logged until the check passes, and a failed check returns a
 * boolean with no body content in the log. A replay guard (event.time within
 * 15 minutes of now) is added on top, because the scheme alone would accept
 * a captured event re-sent any number of times: the handler is
 * idempotent (§7.6 criterion 5), but a webhook that costs a vault write and
 * an email should not be replayable for free.
 *
 * ── WHY `dataBase64` ───────────────────────────────────────────────────────
 * The create endpoint takes files as base64 in the JSON body. A signed PDF
 * is at most a few hundred KB; base64 inflates it by a third, which at this
 * size is nothing, and it keeps the request one well-understood JSON shape
 * rather than a multipart assembly with its own failure modes.
 * ══════════════════════════════════════════════════════════════════════════
 */
"use strict";

const crypto = require("crypto");
const axios = require("axios");
const { AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");

const BASE_URL = "https://www.signwell.com/api/v1";
const TIMEOUT_MS = 30_000;

/** Webhook events older than this are replays, not deliveries. */
/**
 * The replay window, backward in time: an event older than this is a
 * capture being replayed, and the HMAC alone would accept it forever,
 * because event.time is what the signature covers.
 */
const WEBHOOK_REPLAY_WINDOW_MS = 15 * 60 * 1000;
/**
 * The forward-skew allowance: a little clock drift is ordinary, a timestamp
 * in the future is not. Symmetric `Math.abs` would accept an event stamped
 * fifteen minutes AHEAD exactly as readily as one fifteen minutes old — the
 * skew allowance is deliberately minutes, not the whole window.
 */
const WEBHOOK_FUTURE_SKEW_MS = 2 * 60 * 1000;

let warnedStringTime = false;

/**
 * The provider's document status → the envelope vocabulary (10785).
 *
 * SignWell has no `expired` or `bounced` value in our enum, and there is no
 * point inventing one: both are terminal failures of the same kind (the
 * provider will not complete this document), and `last_error` says which.
 * Mapping them to distinct statuses would teach the poll backstop to poll a
 * document that is already over.
 */
const STATUS_MAP = {
  created: "CREATING",
  sent: "SENT",
  viewed: "SENT",
  pending: "SENT", // SignWell's "in progress" is still an open envelope
  completed: "COMPLETED",
  declined: "DECLINED",
  canceled: "CANCELLED",
  expired: "FAILED",
  bounced: "FAILED",
  error: "FAILED",
};

/**
 * A provider error, classified. `retryable` is the poll backstop's answer to
 * "should I try again in thirty minutes": a 5xx or a 429 is a provider
 * blip, a 401/404/422 is a fact that will not change on its own and should
 * be surfaced instead of re-polled until the moon is full.
 */
class ProviderError extends Error {
  constructor(message, { status = null, retryable = false, providerCode = null } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.retryable = retryable;
    this.providerCode = providerCode;
  }
}

function providerMessage(err) {
  const d = err.response && err.response.data;
  if (!d || typeof d !== "object") return null;
  // The documented error shape is { meta: { error, message } }; older or
  // unexpected shapes carry a top-level message.
  return (d.meta && (d.meta.message || d.meta.error)) || d.message || null;
}

/**
 * One HTTP call to the provider. Every method below goes through here, so
 * timeout, auth and error classification exist in exactly one place.
 */
async function request(cfg, { method, path, body = null, query = null, binary = false }) {
  // Loop trim, the verify-link.normaliseBase decision: no trailing
  // quantifier on a configurable value.
  let base = String(cfg.baseUrl || BASE_URL);
  while (base.endsWith("/")) base = base.slice(0, -1);
  const url = `${base}${path}`;
  try {
    const res = await axios({
      method,
      url,
      headers: { "X-Api-Key": cfg.apiKey, Accept: binary ? "application/pdf" : "application/json" },
      params: query || undefined,
      data: body,
      timeout: TIMEOUT_MS,
      responseType: binary ? "arraybuffer" : "json",
      maxBodyLength: Infinity,
    });
    return binary ? Buffer.from(res.data) : res.data;
  } catch (err) {
    const status = err.response ? err.response.status : null;
    // 429 and 5xx: the provider is the problem, and the provider recovers.
    const retryable = status === 429 || (status !== null && status >= 500) || status === null;
    throw new ProviderError(
      providerMessage(err) || `SignWell ${method} ${path} failed${status ? ` (HTTP ${status})` : " (network error)"}`,
      { status, retryable, providerCode: providerMessage(err) ? "provider_error" : null },
    );
  }
}

/**
 * Register a callback URL, or find the one already registered for it.
 *
 * Idempotent on the URL: a tenant re-creating envelopes after a webhook row
 * was lost must not stack a second webhook — two registrations would mean
 * every event arrives twice, and while the handler is idempotent, doubling
 * the provider's deliveries for the lifetime of the account is the kind of
 * thing nobody finds until the invoice.
 */
async function ensureWebhook({ apiKey, callbackUrl }) {
  // `request` already returns the response body (its `.data`), not the
  // response envelope — destructuring `.data` off it would read `array.data`.
  const data = await request({ apiKey }, { method: "GET", path: "/hooks" });
  const existing = (Array.isArray(data) ? data : []).find(
    (h) => h && h.callback_url === callbackUrl,
  );
  if (existing) return { webhookId: existing.id, created: false };
  const created = await request({ apiKey }, { method: "POST", path: "/hooks", body: { callback_url: callbackUrl } });
  return { webhookId: created.id, created: true };
}

/**
 * Create (and send) the provider's document.
 *
 * `parties` carries the ONE party this envelope settles — the counterparty
 * who picked the CERTIFIED card. The chain around them stays on our side:
 * the issuer already signed through the internal path (rule 2), and later
 * parties sign after this one settles, so the provider sees exactly the
 * signature it is accountable for.
 *
 * The metadata block is the belt to the provider_ref's suspenders: the
 * webhook's `data.object.id` is the mapping of record, but a human reading a
 * provider dashboard should be able to say which envelope a document is.
 */
async function createEnvelope({ apiKey, document, parties, callbackUrl, webhookId, language = "en", metadata = {} }) {
  if (!apiKey) throw new AppError("QES_NOT_CONFIGURED", "No signing provider credentials are configured.", 409);
  if (!document || !document.dataBase64) throw new AppError("NO_DOCUMENT", "There is no rendered document to certify.", 409);
  if (!Array.isArray(parties) || !parties.length) throw new AppError("NO_PARTIES", "A certified envelope needs a signatory.", 422);

  // The webhook must exist before the document is sent, or the first event
  // has nowhere to land and only the poll backstop (thirty minutes) notices.
  const hook = webhookId ? { webhookId } : await ensureWebhook({ apiKey, callbackUrl });

  const body = {
    name: document.name,
    files: [{ name: document.fileName || "document.pdf", data: document.dataBase64 }],
    recipients: parties.map((p, i) => ({
      email: p.email,
      name: p.name,
      // SignWell's recipient has no role field; the role is our seal's
      // business, not the provider's. Kept out of the request on purpose.
      signing_order: p.signingOrder || i + 1,
    })),
    apply_signing_order: true,
    language,
    embedded_signing: false, // the provider EMAILS the signer; that is the point
    allow_decline: true,
    reminders: true,
    test_mode: false,
    metadata,
  };

  const doc = await request({ apiKey }, { method: "POST", path: "/documents/", body });
  if (!doc || !doc.id) throw new ProviderError("SignWell create returned no document id", { retryable: false });

  return {
    envelopeId: doc.id,
    webhookId: hook.webhookId,
    partyLinks: (doc.recipients || []).map((r) => r.signing_url).filter(Boolean),
  };
}

/**
 * Cancel in-flight signing. DELETE is the provider's cancel primitive
 * (deleting a document "will also cancel document signing (if in progress)").
 * Cancelling a COMPLETED document is a 4xx — the caller treats that as
 * already-settled, not as a failure, because the provider cannot un-sign.
 */
async function cancelEnvelope({ apiKey, envelopeId, reason = null }) {
  if (!apiKey || !envelopeId) throw new AppError("NO_ENVELOPE", "No provider envelope to cancel.", 409);
  try {
    await request({ apiKey }, { method: "DELETE", path: `/documents/${envelopeId}` });
  } catch (err) {
    if (err instanceof ProviderError && err.status === 404) {
      // Gone on the provider's side: nothing to cancel, and a 404 here is
      // not an error state worth a FAILED envelope — the row keeps its own
      // status and the reason stays in the log.
      return { cancelled: true, alreadyGone: true };
    }
    if (err instanceof ProviderError && err.status && err.status < 500 && err.status !== 429) {
      throw new AppError("QES_CANCEL_REFUSED", `The provider refused the cancellation: ${err.message}`, 409,
        { provider: "signwell", reason: reason || null });
    }
    throw new AppError("QES_PROVIDER_ERROR", err.message, 502, { provider: "signwell", reason: reason || null });
  }
  return { cancelled: true, alreadyGone: false };
}

/**
 * The provider's current state, normalised to the envelope vocabulary.
 * A 404 means the document no longer exists on the provider's side — the
 * caller reads that as a failed envelope, because a document that cannot be
 * found cannot be completed.
 */
async function getStatus({ apiKey, envelopeId }) {
  if (!apiKey || !envelopeId) throw new AppError("NO_ENVELOPE", "No provider envelope to query.", 409);
  let doc;
  try {
    doc = await request({ apiKey }, { method: "GET", path: `/documents/${envelopeId}` });
  } catch (err) {
    if (err instanceof ProviderError && err.status === 404) {
      return { status: "FAILED", parties: [], gone: true, error: "document no longer exists on the provider" };
    }
    // A blip is re-thrown as-is: the caller (the poll) classifies retryable
    // from the ProviderError itself, and wrapping it would lose the flag.
    throw err;
  }
  return {
    status: STATUS_MAP[String(doc.status || "").toLowerCase()] || "SENT",
    parties: (doc.recipients || []).map((r) => ({
      email: r.email || null,
      status: String(r.status || "created").toLowerCase(),
      signedAt: r.signed_at || r.completion_date || null,
    })),
    error: doc.error_message || null,
  };
}

/** The provider's signed PDF, without the audit page. */
async function fetchSignedDocument({ apiKey, envelopeId }) {
  if (!apiKey || !envelopeId) throw new AppError("NO_ENVELOPE", "No provider envelope to fetch.", 409);
  const buf = await request({ apiKey }, {
    method: "GET", path: `/documents/${envelopeId}/completed_pdf`,
    query: { file_format: "pdf", audit_page: false }, binary: true,
  });
  if (!buf || !buf.length) throw new ProviderError("SignWell returned an empty completed PDF", { retryable: true });
  return buf;
}

/**
 * The provider's audit certificate — the completed PDF with the Audit & Lock
 * page appended (names, emails, IPs, timestamps, per SignWell's documented
 * Audit & Lock feature). Mirrored into our vault on completion (§7.4): the
 * certificate a dispute turns on must be ours to produce in year seven, not
 * a link to a dashboard the contract no longer covers.
 */
async function fetchAuditCertificate({ apiKey, envelopeId }) {
  if (!apiKey || !envelopeId) throw new AppError("NO_ENVELOPE", "No provider envelope to fetch.", 409);
  const buf = await request({ apiKey }, {
    method: "GET", path: `/documents/${envelopeId}/completed_pdf`,
    query: { file_format: "pdf", audit_page: true }, binary: true,
  });
  if (!buf || !buf.length) throw new ProviderError("SignWell returned an empty audit PDF", { retryable: true });
  return buf;
}

/**
 * Verify an incoming webhook event. Returns a boolean and nothing else —
 * the caller must be able to reject on `false` without a throw, and without
 * logging anything from the body.
 *
 * Order of checks, cheapest first: shape, then freshness, then the HMAC.
 * Every failure returns false identically — a webhook that 500s on a
 * malformed body tells the provider to retry, which is not what a forged
 * event wants.
 */
function verifyWebhook({ _headers, rawBody, secret }) {
  try {
    if (!secret || typeof rawBody !== "string" || !rawBody) return false;
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return false; // not even JSON: nothing to verify
    }
    const event = body && body.event;
    if (!event || typeof event.type !== "string" || typeof event.hash !== "string") return false;

    // event.time, defensively. The documented shape is a number, but failing
    // closed SILENTLY on a shape change is the wrong failure: every webhook
    // dies with no signal distinguishing "the provider changed its payload"
    // from "someone is forging events". A numeric string is coerced — and
    // logged ONCE, so the mismatch is visible without becoming a log flood.
    let time = event.time;
    if (typeof time === "string" && time.trim() !== "" && Number.isFinite(Number(time))) {
      time = Number(time);
      if (!warnedStringTime) {
        warnedStringTime = true;
        logger.warn("signwell webhook sent event.time as a string — accepted and coerced; check the provider's payload shape");
      }
    }
    if (typeof time !== "number" || !Number.isFinite(time)) return false;

    // The window is on the EVENT TIME, not our arrival time — event.time is
    // what the HMAC covers, so a replayed capture carries its original (now
    // stale) time and fails here even though its hash is perfect.
    // ASYMMETRIC on purpose: backward is the replay window (15 min), forward
    // is a small clock-skew allowance (2 min). `Math.abs` would accept a
    // future-stamped event as readily as a replay, and a forgery does not
    // have to get the clock right at all.
    const drift = Date.now() - time * 1000;
    if (drift > WEBHOOK_REPLAY_WINDOW_MS || drift < -WEBHOOK_FUTURE_SKEW_MS) return false;

    const expected = crypto.createHmac("sha256", secret).update(`${event.type}@${time}`).digest("hex");
    const given = String(event.hash).toLowerCase();
    if (expected.length !== given.length) return false;
    // Constant-time: the hash is 256 bits of provider state, and a timing
    // oracle over it buys nothing today but costs nothing to close.
    return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(given, "utf8"));
  } catch {
    // A verify that THROWS turns "reject this event" into "500, retry
    // forever" — the provider retries webhooks, and a forged event that
    // crashes the handler is a DoS vector dressed as a signature.
    return false;
  }
}

/**
 * The connectivity probe for Platform Console → Integrations. A single
 * read-only GET /me: it proves the key authenticates and returns the account
 * name and plan tier so the operator can see WHICH account the key is for —
 * the one thing a wrong key's error message never says.
 */
async function probe({ apiKey }) {
  if (!apiKey) throw new AppError("QES_NOT_CONFIGURED", "No signing provider credentials are configured.", 409);
  const me = await request({ apiKey }, { method: "GET", path: "/me" });
  const account = (me && (me.account || me.workspace)) || {};
  return {
    account: account.name || null,
    plan_tier: account.plan_tier || null,
    checked: "/me",
  };
}

module.exports = {
  key: "signwell",
  BASE_URL,
  STATUS_MAP,
  WEBHOOK_REPLAY_WINDOW_MS,
  WEBHOOK_FUTURE_SKEW_MS,
  ProviderError,
  createEnvelope,
  cancelEnvelope,
  getStatus,
  fetchSignedDocument,
  fetchAuditCertificate,
  verifyWebhook,
  probe,
  ensureWebhook,
};
