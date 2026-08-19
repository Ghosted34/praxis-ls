/**
 * Which conversation a message belongs to.
 *
 * ── WHY THIS IS NOT "GROUP BY SUBJECT" ──────────────────────────────────────
 *
 * Because two people who both write "Re: Invoice" are having two conversations,
 * and merging them puts one client's correspondence in another's thread. That is
 * the classic threading bug and it is unrecoverable once the rows are written, so
 * subject is used only as a tiebreak inside an already-matching participant set —
 * never as the key.
 *
 * ── THE LADDER ──────────────────────────────────────────────────────────────
 *
 *   1. the provider's own thread id, where the provider has one
 *      (Graph conversationId, Gmail threadId — they know more than we can infer)
 *   2. References[0] — the root of the reply chain, per RFC 5322 §3.6.4
 *   3. In-Reply-To — a reply whose client dropped References
 *   4. the message's own Message-Id — a conversation of one
 *
 * Anything with no identifier at all falls back to the external id the adapter
 * assigned, so a message can never be threadless.
 *
 * PURE. No I/O. That is what makes every branch cheap to test, and threading is
 * the thing most worth testing exhaustively.
 */
"use strict";

/** RFC 5322 message identifiers are angle-bracketed; servers are inconsistent. */
function normaliseId(id) {
  if (!id) return null;
  const t = String(id).trim();
  if (!t) return null;
  const bare = t.replace(/^</, "").replace(/>$/, "").trim();
  return bare ? `<${bare}>` : null;
}

/** `References` arrives as an array, a space-separated string, or nothing. */
function normaliseReferences(refs) {
  if (!refs) return [];
  const list = Array.isArray(refs) ? refs : String(refs).split(/\s+/);
  const out = [];
  for (const r of list) {
    const n = normaliseId(r);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * The thread key for a normalized message.
 *
 * `providerThreadId` is only trusted when the adapter says it has server-side
 * threads — an adapter that returns an id it synthesised itself would make the
 * key depend on our own inference twice over.
 */
function threadKeyFor(message = {}, capabilities = {}) {
  if (capabilities.serverThreads && message.providerThreadId) {
    return `provider:${String(message.providerThreadId).trim()}`;
  }
  const references = normaliseReferences(message.references);
  if (references.length) return references[0];
  const inReplyTo = normaliseId(message.inReplyTo);
  if (inReplyTo) return inReplyTo;
  const own = normaliseId(message.messageIdHeader || message.externalMessageId);
  if (own) return own;
  return String(message.externalMessageId || "").trim() || null;
}

/** `Re:`, `Fwd:`, `RE :`, `TR:`, `Rép:` — stripped for display, never for keying. */
const REPLY_PREFIX = /^\s*((re|ref|aw|sv|vs|fw|fwd|tr|rép|rep)\s*(\[\d+\])?\s*:\s*)+/i;
const baseSubject = (s) => String(s || "").replace(REPLY_PREFIX, "").trim();

/**
 * Everyone who has appeared in a conversation, lowercased and de-duplicated.
 * Used for the thread list's "who is in this" and to match a thread to a party;
 * the mailbox's own address is kept, because a thread where we are the only
 * participant is a real (if lonely) state and hiding it would look like a bug.
 */
function participantsOf(messages = []) {
  const seen = new Set();
  for (const m of messages) {
    for (const a of [m.from, ...(m.to || []), ...(m.cc || [])]) {
      const v = String(a || "").trim().toLowerCase();
      if (v) seen.add(v);
    }
  }
  return [...seen];
}

/**
 * Merge one message into a thread's running summary.
 *
 * Returns the fields to write, rather than mutating: the caller is inside a
 * transaction and needs to decide whether anything actually changed before it
 * spends a write.
 */
function foldIntoThread(thread, message) {
  const receivedAt = message.receivedAt ? new Date(message.receivedAt) : new Date();
  const first = thread && thread.first_message_at ? new Date(thread.first_message_at) : receivedAt;
  const last = thread && thread.last_message_at ? new Date(thread.last_message_at) : receivedAt;
  const existing = (thread && thread.participants) || [];
  const incoming = participantsOf([message]);
  const participants = [...new Set([...existing.map((p) => String(p).toLowerCase()), ...incoming])];
  return {
    // The FIRST subject wins. A thread renamed halfway by someone's client
    // should not rename the conversation everyone else is reading.
    subject: (thread && thread.subject) || baseSubject(message.subject) || null,
    participants,
    has_attachment: Boolean((thread && thread.has_attachment) || (message.attachments || []).length),
    first_message_at: receivedAt < first ? receivedAt : first,
    last_message_at: receivedAt > last ? receivedAt : last,
  };
}

module.exports = { normaliseId, normaliseReferences, threadKeyFor, baseSubject, participantsOf, foldIntoThread };
