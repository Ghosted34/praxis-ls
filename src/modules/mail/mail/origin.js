/**
 * Origin tagging — telling apart mail we sent from mail the user sent elsewhere.
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────
 *
 * An operator answers a client from Praxis on Monday and from their phone on
 * Tuesday. Both messages sit in the mailbox's Sent folder, so once that folder
 * is synced both appear in the workspace looking identical. "Did this go out
 * through the ERP?" then has no answer, and the more useful question — "what
 * correspondence with this client never reached the record?" — has none either.
 *
 * ── WHY A HEADER AND NOT A FOOTER ───────────────────────────────────────────
 *
 * The tag has to survive a round trip through someone else's mail server and
 * come back to us when we re-read the message. A header does; it is also
 * invisible to the recipient, which matters because our internal tooling has no
 * business appearing on a commercial quotation.
 *
 * ── AND WHY IT CANNOT BE INFERRED LATER ─────────────────────────────────────
 *
 * Matching a Sent-folder message against our own send log on subject and
 * timestamp is guesswork that fails on retries, on two messages a minute apart,
 * and on everything sent before the log existed. So we generate our own RFC 5322
 * Message-ID, store it, and stamp the headers at send time. Anything sent before
 * this module existed is UNKNOWN — deliberately, because a system that
 * confidently mislabels three years of history is worse than one that says it
 * does not know.
 *
 * The same stored Message-ID is what later lets a bounce — which quotes the
 * original Message-ID in its delivery-status report — be tied back to the
 * message that bounced.
 *
 * PURE. No I/O, no database, no config reads. That is what makes it cheap to
 * test every branch.
 */
"use strict";

const crypto = require("crypto");

/** The header namespace. Kept as one constant so a rename touches one line. */
const PREFIX = "X-Praxis";
const H_ORIGIN = `${PREFIX}-Origin`;
const H_TENANT = `${PREFIX}-Tenant`;
const H_USER = `${PREFIX}-User`;
const H_SEND_POINT = `${PREFIX}-Send-Point`;
const H_CONNECTION = `${PREFIX}-Connection`;

/** The value of X-Praxis-Origin. Presence is the signal; the value is for humans. */
const ORIGIN_VALUE = "praxis-ls";

const SENT_VIA = { PRAXIS: "PRAXIS", EXTERNAL: "EXTERNAL", UNKNOWN: "UNKNOWN" };

/**
 * Case-insensitive header read.
 *
 * Header names are case-insensitive per RFC 5322, and the three providers hand
 * them back in three different cases (imapflow lowercases, Graph preserves what
 * the sender wrote, Gmail returns an array of {name, value}). Reading `h["X-Praxis-Origin"]`
 * directly therefore works in tests and fails against a real mailbox, which is
 * the worst possible split.
 */
function headerValue(headers, name) {
  if (!headers) return null;
  const want = String(name).toLowerCase();
  // Array-of-pairs shape (Gmail's payload.headers).
  if (Array.isArray(headers)) {
    const hit = headers.find((h) => h && String(h.name || "").toLowerCase() === want);
    return hit ? hit.value : null;
  }
  // Map shape (imapflow) or plain object.
  if (typeof headers.get === "function") {
    const v = headers.get(want) ?? headers.get(name);
    if (v !== undefined && v !== null) return Array.isArray(v) ? v[0] : v;
  }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === want) {
      const v = headers[key];
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return null;
}

/**
 * The headers to stamp on an outbound message.
 *
 * `sendPoint` is which part of the product is sending (an ERP send point key for
 * system mail, `user.compose` when a human wrote it). Recording it means a
 * message can later be traced to the feature that produced it, which is what
 * makes "why did the client get this?" answerable.
 */
function buildOriginHeaders({ tenantSlug = null, userId = null, sendPoint = null, connectionId = null } = {}) {
  const h = { [H_ORIGIN]: ORIGIN_VALUE };
  if (tenantSlug) h[H_TENANT] = String(tenantSlug);
  if (userId) h[H_USER] = String(userId);
  if (sendPoint) h[H_SEND_POINT] = String(sendPoint);
  if (connectionId) h[H_CONNECTION] = String(connectionId);
  return h;
}

/**
 * An RFC 5322 Message-ID we own.
 *
 * The domain half must be one we can claim, so it comes from the sending address
 * rather than being invented — a Message-ID at a domain we do not control is the
 * kind of detail a strict receiver scores against.
 */
function generateMessageId(fromAddress) {
  const at = String(fromAddress || "").lastIndexOf("@");
  const domain = at > -1 ? String(fromAddress).slice(at + 1).trim().toLowerCase() : "praxisls.com";
  const safeDomain = /^[a-z0-9.-]+$/.test(domain) && domain.includes(".") ? domain : "praxisls.com";
  return `<${crypto.randomUUID()}@${safeDomain}>`;
}

/**
 * Was this outbound message sent by us?
 *
 * Only ever called for `direction === 'OUT'`. An inbound message has no origin
 * to attribute — the 10727 CHECK constraint enforces that, and this function
 * refusing to guess is the other half of it.
 */
function classifyOutbound(headers) {
  const v = headerValue(headers, H_ORIGIN);
  return v && String(v).trim().toLowerCase() === ORIGIN_VALUE ? SENT_VIA.PRAXIS : SENT_VIA.EXTERNAL;
}

/** What our own stamp said, for a message we recognise as ours. */
function parseOrigin(headers) {
  return {
    tenantSlug: headerValue(headers, H_TENANT),
    userId: headerValue(headers, H_USER),
    sendPoint: headerValue(headers, H_SEND_POINT),
    connectionId: headerValue(headers, H_CONNECTION),
  };
}

/**
 * The origin fields to store for a synced outbound message.
 *
 * A message we sent carries its own attribution; one sent elsewhere carries
 * none, and inventing a user for it would misattribute somebody's phone reply to
 * whoever happens to own the connection. So EXTERNAL returns nulls.
 */
function originFieldsFor({ direction, headers, messageIdHeader = null }) {
  if (direction !== "OUT") {
    return { sent_via: null, origin_user_id: null, origin_send_point: null, message_id_header: messageIdHeader };
  }
  const sentVia = classifyOutbound(headers);
  if (sentVia !== SENT_VIA.PRAXIS) {
    return { sent_via: sentVia, origin_user_id: null, origin_send_point: null, message_id_header: messageIdHeader };
  }
  const o = parseOrigin(headers);
  return {
    sent_via: SENT_VIA.PRAXIS,
    // Only accept a uuid — the header is attacker-influencable in principle
    // (anyone can add X-Praxis-User to a message they send us), and a malformed
    // value would 22P02 the insert rather than being ignored.
    origin_user_id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(o.userId || "")) ? o.userId : null,
    origin_send_point: o.sendPoint ? String(o.sendPoint).slice(0, 64) : null,
    message_id_header: messageIdHeader,
  };
}

module.exports = {
  PREFIX, ORIGIN_VALUE, SENT_VIA,
  H_ORIGIN, H_TENANT, H_USER, H_SEND_POINT, H_CONNECTION,
  headerValue, buildOriginHeaders, generateMessageId,
  classifyOutbound, parseOrigin, originFieldsFor,
};
