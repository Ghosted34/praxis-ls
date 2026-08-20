/**
 * Drafts, and the send queue that makes undo-send possible.
 *
 * ── SENDING IS A QUEUE, NOT A FUNCTION CALL ─────────────────────────────────
 *
 * `send()` here writes a row and returns. It does not open an SMTP connection,
 * and the HTTP request does not wait for one. The message leaves when the
 * flusher picks it up, a few seconds later.
 *
 * That gap is not latency to be apologised for — it is the feature. Undo exists
 * only because the send has not happened yet, and cancelling is one UPDATE with
 * a rowcount check, so the race against the flusher is settled by Postgres
 * rather than by a timer in a browser that may be closed by then.
 *
 * ── THE PAYLOAD IS FROZEN AT ENQUEUE, AND THAT IS DELIBERATE ────────────────
 *
 * Everything the message needs — recipients, both body parts, the resolved
 * attachment ids, the origin headers, the Message-ID — is serialized into
 * `payload` when the user presses Send. The flusher reads only that.
 *
 * The alternative, re-deriving from the draft at flush time, means what leaves
 * is whatever the draft happened to say a few seconds later. Someone who edits
 * a draft in another tab, or a signature that changes in between, would alter a
 * message that a person already read and approved. Nobody would ever see it
 * happen.
 *
 * ── WHERE THE THROTTLE IS CHECKED, AND WHY TWICE ────────────────────────────
 *
 * At enqueue, so the user is told immediately and does not discover twenty
 * minutes later that their message never went. And again at flush, because the
 * queue can hold a burst that was individually under the cap and collectively
 * over it — the check at enqueue cannot see messages that are not sent yet.
 */
"use strict";

const repo = require("./outbox.repo");
const mailRepo = require("./mail.repo");
const threadRepo = require("./thread.repo");
const mailbox = require("./mailbox.service");
const access = require("./access");
const compose = require("./compose");
const origin = require("./origin");
const schedule = require("./schedule");
const presend = require("./presend");
const events = require("./mail.events");
const { AppError } = require("../../../utils/errors");
const { emitEvent } = require("../../../shared/events/emit");
const { getSetting } = require("../../../shared/config/settings");
const { logger } = require("../../../config/logger");

const MODULE = "MOD-72";
/** Total across all files, not per file (Q9). */
const ATTACH_MAX_BYTES = 25 * 1024 * 1024;
/** Above this the composer offers a secure link instead — PR-5 wires it. */
const SECURE_LINK_HINT_BYTES = 10 * 1024 * 1024;
const UNDO_CHOICES = [0, 10, 20, 30];
const DEFAULT_UNDO_SECONDS = 20;
const MAX_ATTEMPTS = 3;

const qRef = (id) => `email_send_queue:${id}`;

/**
 * How long Send waits before it is irreversible.
 *
 * Tenant-configurable, and 0 is a legitimate answer — someone who has never once
 * wanted the undo should be able to turn it off rather than wait every time. Any
 * other value is refused rather than silently clamped: a typo that produced a
 * 200-second hold would look like sending was broken.
 */
async function undoSeconds(client) {
  const limits = (await getSetting(client, "mail", "limits", {})) || {};
  const raw = limits.undo_send_seconds;
  if (raw === undefined || raw === null || raw === "") return DEFAULT_UNDO_SECONDS;
  const n = Number(raw);
  return UNDO_CHOICES.includes(n) ? n : DEFAULT_UNDO_SECONDS;
}

/* ── Drafts ───────────────────────────────────────────────────────────────── */

/**
 * Autosave. Serializes on every save so the stored HTML can never lag the JSON.
 *
 * The serializer runs here, not at send, because it is also what produces the
 * warnings the composer shows — an oversized message or an image with no
 * description is worth knowing about while there is still time to fix it, not in
 * a dialog at the moment of sending.
 */
async function saveDraft(client, actor, input = {}) {
  if (!actor.user_id) throw new AppError("VALIDATION_ERROR", "a draft needs an author", 422);

  // The rendered parts are added ONLY when a document came with this save. The
  // repo reads `undefined` as "not provided" and `null` as "clear it", so
  // passing null here would erase the message body every time someone edited the
  // subject line — invisibly, because the editor still shows what it has in
  // memory and only the reopened draft would be empty.
  const rendered = {};
  let warnings = [];
  if (input.body_json) {
    const out = compose.serialize(input.body_json);
    rendered.body_html = out.html;
    rendered.body_text = out.text;
    warnings = out.warnings;
  } else if (input.body_json === null) {
    // An explicit null is the composer clearing the body, and must reach the row.
    rendered.body_html = null;
    rendered.body_text = null;
  }

  const row = await repo.upsertDraft(client, actor.user_id, { ...input, ...rendered });

  // ONCE PER DRAFT, not per keystroke — which is what 10739's own description
  // promises and what makes the event usable at all. The composer autosaves
  // every few seconds; an event per save would bury the log under one
  // conversation's typing.
  //
  // "New" is the absence of an incoming id: the composer sends none on the
  // first save and echoes it back on every save after. Nothing else in the
  // response distinguishes them, and asking the repo would be a second query
  // to learn something the caller already knew.
  if (!input.email_draft_id && row && row.email_draft_id) {
    await emitEvent(client, {
      eventTypeKey: "email.draft.saved", moduleKey: MODULE,
      entityRef: `email_draft:${row.email_draft_id}`,
      actorUserId: actor.user_id || null,
      payload: { thread_id: row.email_thread_id || null, kind: row.kind || null },
    }).catch(() => { /* @silent:storage the draft row is the outcome, not its event */ });
  }

  return { ...row, warnings };
}

const getDraft = (client, actor, id) => repo.getDraft(client, actor.user_id, id);
const listDrafts = (client, actor, q = {}) =>
  repo.listDrafts(client, actor.user_id, { threadId: q.thread_id, limit: q.limit });

async function discardDraft(client, actor, id) {
  const gone = await repo.deleteDraft(client, actor.user_id, id);
  if (!gone) throw new AppError("NOT_FOUND", "draft not found", 404);
  return { email_draft_id: id, discarded: true };
}

/* ── Attachments ──────────────────────────────────────────────────────────── */

/**
 * The 25 MB rule, checked against what is ALREADY staged.
 *
 * On the sum rather than per file, because the recipient's mail host rejects on
 * the total and five 6 MB files each pass a per-file check. Checked before the
 * bytes are stored, so a file that would breach the cap is refused rather than
 * written to the vault and then deleted.
 */
async function assertRoomFor(client, draftId, bytes) {
  const already = await repo.draftAttachmentBytes(client, draftId);
  const total = already + Number(bytes || 0);
  if (total > ATTACH_MAX_BYTES) {
    const mb = (n) => (n / (1024 * 1024)).toFixed(1);
    throw new AppError(
      "ATTACHMENT_TOO_LARGE",
      `That would make ${mb(total)} MB of attachments. The limit is 25 MB for the whole message, `
      + `and ${mb(already)} MB is already attached. Most mail servers reject anything larger.`,
      413,
      { total_bytes: total, limit_bytes: ATTACH_MAX_BYTES, already_bytes: already },
    );
  }
  return { total_bytes: total, offer_secure_link: total > SECURE_LINK_HINT_BYTES };
}

/* ── Sending ──────────────────────────────────────────────────────────────── */

/**
 * Everything that has to be true before a message may be queued.
 *
 * Ordered so the cheapest and most likely refusals come first, and so the user
 * is never told about a rate limit on a message that has no recipient.
 */
async function validateSend(client, actor, input) {
  const to = [].concat(input.to || []).map((a) => String(a || "").trim()).filter(Boolean);
  if (!to.length) throw new AppError("VALIDATION_ERROR", "a message needs at least one recipient", 422);
  if (!input.connectionId) throw new AppError("VALIDATION_ERROR", "a message needs a mailbox to send from", 422);

  const conn = await mailRepo.getConnection(client, input.connectionId);
  if (!conn) throw new AppError("NOT_FOUND", "mailbox not found", 404);
  if (conn.status === "ARCHIVED") {
    throw new AppError("MAILBOX_ARCHIVED", `${conn.email_address} has been retired and cannot send.`, 422);
  }
  if (actor.user_id) await access.assertCanSend(client, conn.email_connection_id, actor.user_id);

  // Told now rather than in twenty minutes. Re-checked at flush, because the
  // queue can hold a burst that was individually under the cap.
  const allowance = await mailbox.checkSendAllowance(client, conn.email_connection_id, 1);
  if (!allowance.allowed) {
    throw new AppError(
      "SEND_RATE_LIMIT",
      allowance.reason === "DAILY_LIMIT"
        ? `${conn.email_address} has reached its daily send limit of ${allowance.limit}. Sending resumes after midnight UTC.`
        : `${conn.email_address} has reached its hourly send limit of ${allowance.limit}. Sending resumes at ${new Date(allowance.retryAt).toISOString().slice(11, 16)} UTC.`,
      429,
      { retry_at: allowance.retryAt, limit: allowance.limit, reason: allowance.reason },
    );
  }
  return { conn, to };
}

/**
 * Queue a message. Returns as soon as the row is written.
 *
 * @returns {{email_send_queue_id, release_at, undo_seconds, warnings}}
 */
async function send(client, actor, input = {}) {
  const { conn, to } = await validateSend(client, actor, input);

  // The body. A caller may pass a TipTap document or pre-rendered parts; the
  // document wins, because the serializer is the authority on what gets sent
  // and a caller-supplied HTML string has not been through it.
  let html = input.html || null;
  let text = input.text || null;
  let warnings = [];
  let cids = [];
  if (input.body_json) {
    const out = compose.serialize(input.body_json, {
      quotedHtml: input.quoted_html, quotedText: input.quoted_text,
    });
    html = out.html; text = out.text; warnings = out.warnings; cids = out.cids;
  }
  if (!html && !text) throw new AppError("VALIDATION_ERROR", "a message needs a body", 422);

  // Signature is baked into the FROZEN payload here, not at flush. A promotion
  // that lands in the undo window must not rewrite a message the sender already
  // approved. A failure here must not block the send — a missing signature is
  // recoverable, a lost invoice is not.
  try {
    const baked = await attachSignature(client, actor, input, html, text);
    html = baked.html; text = baked.text;
  } catch { /* @silent:storage the message without a signature is still the message */ }

  const draftId = input.email_draft_id || null;
  const attachments = draftId ? await repo.listDraftAttachments(client, draftId) : [];
  if (attachments.length) await assertRoomFor(client, draftId, 0);

  // §8.8's one hard block, on the path every send takes. Deliberately AFTER the
  // signature and the attachment list, so the check sees the message as it will
  // actually leave — a bank detail introduced by a signature template is inside
  // the check, not appended after it. Throws GUARDRAIL_BLOCKED (422) when a
  // block stands with no typed override reason; writes the reason to the
  // immutable ledger when one is given.
  const guard = await presend.check(client, actor, input, { html, text, attachments });
  warnings = warnings.concat(guard.warnings || []);

  const messageId = origin.generateMessageId(conn.email_address);
  const headers = origin.buildOriginHeaders({
    tenantSlug: input.slug || null,
    userId: actor.user_id || null,
    sendPoint: input.sendPoint || "user.compose",
    connectionId: conn.email_connection_id,
  });

  // Scheduling (§9.3) and undo-send are the same mechanism with different
  // delays, so exactly ONE of them decides `release_at`. If both computed it, a
  // message scheduled for Tuesday would also be "undoable" for twenty seconds
  // and then not for six days — which is neither feature.
  const scheduled = await schedule.resolveReleaseAt(client, input, { to });

  const seconds = input.undo_seconds !== undefined && UNDO_CHOICES.includes(Number(input.undo_seconds))
    ? Number(input.undo_seconds)
    : await undoSeconds(client);
  const releaseAt = scheduled ? scheduled.releaseAt : new Date(Date.now() + seconds * 1000);

  const row = await repo.enqueue(client, {
    email_connection_id: conn.email_connection_id,
    user_id: actor.user_id || null,
    email_draft_id: draftId,
    email_thread_id: input.email_thread_id || null,
    release_at: releaseAt,
    idempotency_key: input.idempotency_key || null,
    // Frozen here. See the header.
    payload: {
      to,
      cc: [].concat(input.cc || []).filter(Boolean),
      bcc: [].concat(input.bcc || []).filter(Boolean),
      subject: input.subject || null,
      html,
      text,
      messageId,
      headers,
      inReplyTo: input.in_reply_to || null,
      references: input.references || [],
      replyToMessageId: input.reply_to_message_id || null,
      sendPoint: input.sendPoint || "user.compose",
      attachmentIds: attachments.map((a) => a.email_attachment_id),
      cids,
    },
  });

  await emitEvent(client, {
    eventTypeKey: "email.send.held", moduleKey: MODULE, entityRef: qRef(row.email_send_queue_id),
    actorUserId: actor.user_id || null,
    payload: { to, subject: input.subject || null, release_at: releaseAt, mailbox: conn.email_address },
  }).catch(() => { /* @silent:storage the queued row is the outcome, not its event */ });

  return {
    email_send_queue_id: row.email_send_queue_id,
    release_at: row.release_at,
    // A scheduled message has no undo window — it has a whole schedule to
    // cancel within, and reporting 20 here would have the composer show a
    // countdown toast for a message going out on Tuesday.
    undo_seconds: scheduled ? 0 : seconds,
    scheduled: scheduled
      ? { reason: scheduled.reason, timezone: scheduled.timezone || null, note: scheduled.note }
      : null,
    status: row.status,
    warnings,
    // Surfaced so the composer can say "sent, and the ledger has your reason"
    // rather than leaving the operator unsure whether the override took.
    guardrail: {
      auth_verdict: guard.verdict,
      overridden: guard.overridden,
      blocks: guard.blocks.map((b) => b.code),
    },
  };
}

/**
 * UNDO. Either the row was still HELD or the message has gone; there is no third
 * answer, and the database gives it.
 */
async function cancel(client, actor, id) {
  const row = await repo.cancel(client, actor.user_id || null, id);
  if (!row) {
    const existing = await repo.getQueued(client, actor.user_id || null, id);
    if (!existing) throw new AppError("NOT_FOUND", "no such queued message", 404);
    throw new AppError(
      "ALREADY_SENT",
      existing.status === "CANCELLED"
        ? "That message was already cancelled."
        : "Too late — that message has already left.",
      409,
      { status: existing.status },
    );
  }
  await emitEvent(client, {
    eventTypeKey: "email.send.cancelled", moduleKey: MODULE, entityRef: qRef(id),
    actorUserId: actor.user_id || null, payload: { to: row.payload?.to, subject: row.payload?.subject },
  }).catch(() => { /* @silent:storage the CANCELLED row is the outcome */ });
  return { email_send_queue_id: id, status: "CANCELLED" };
}

const listQueued = (client, actor, q = {}) => repo.listQueued(client, actor.user_id, q);

/**
 * Should this failure be retried, and when?
 *
 * A permanent refusal is not retried at all. Trying a rejected sender address
 * three times does not make it work; it just delays telling the person something
 * only they can fix, and burns three more entries in the mail host's abuse log.
 */
function retryPlan(err, attempts) {
  const status = err && err.status;
  const code = (err && err.code) || null;
  const permanent = status === 422 || status === 413
    || ["SENDER_NOT_AUTHORIZED", "RECIPIENT_REJECTED", "MAILBOX_ARCHIVED", "AUTH_FAILED"].includes(code);
  if (permanent || attempts >= MAX_ATTEMPTS) return { retryAt: null, code };
  // 30s, 2min, 8min. Long enough for a mail host's transient limit to clear,
  // short enough that a message still arrives while it is relevant.
  const backoff = [30, 120, 480][Math.min(attempts, 2)] * 1000;
  return { retryAt: new Date(Date.now() + backoff), code };
}

/**
 * Send one claimed row. Called only by the flusher, which already owns it.
 *
 * `deps` carries the two things that need a live adapter — injected rather than
 * required, so the whole state machine is testable without a mail server.
 */
async function flushOne(client, row, deps = {}) {
  const { resolveAdapter, recordOutbound, explainSendError, slug = null } = deps;
  const p = row.payload || {};
  try {
    const conn = await mailRepo.getConnection(client, row.email_connection_id);
    if (!conn) throw new AppError("NOT_FOUND", "the mailbox this was queued from no longer exists", 422);

    // Re-checked here, not only at enqueue: a burst that was individually under
    // the cap can be collectively over it, and only the flusher can see that.
    const allowance = await mailbox.checkSendAllowance(client, conn.email_connection_id, 1);
    if (!allowance.allowed) {
      const retryAt = allowance.retryAt ? new Date(allowance.retryAt) : new Date(Date.now() + 300000);
      await repo.markAttemptFailed(client, row.email_send_queue_id, {
        message: `Held by the mailbox's send limit; will try again at ${retryAt.toISOString()}.`,
        code: "SEND_RATE_LIMIT",
        retryAt,
      });
      return { id: row.email_send_queue_id, status: "QUEUED", throttled: true };
    }

    const adapter = await resolveAdapter(client, conn);
    let res;
    try {
      res = await adapter.sendEmail({
        to: p.to, cc: p.cc, bcc: p.bcc, subject: p.subject,
        bodyHtml: p.html, bodyText: p.text,
        messageId: p.messageId, headers: p.headers,
        inReplyTo: p.inReplyTo, references: p.references,
      });
    } catch (err) {
      throw explainSendError ? explainSendError(err, conn) : err;
    }

    await mailbox.recordSent(client, conn.email_connection_id, 1);
    if (conn.kind === "SHARED" || conn.kind === "DELEGATED") {
      await access.recordSentAs(client, {
        connectionId: conn.email_connection_id,
        actor: { user_id: row.user_id },
        to: p.to, subject: p.subject, sendPoint: p.sendPoint,
      }).catch(() => { /* @silent:storage the audit row is secondary to the send */ });
    }

    const message = await recordOutbound(client, conn, {
      ...res, to: p.to, subject: p.subject, html: p.html, text: p.text,
      references: p.references, inReplyTo: p.inReplyTo,
      messageIdHeader: p.messageId, sentVia: origin.SENT_VIA.PRAXIS,
      originUserId: row.user_id || null, originSendPoint: p.sendPoint || "user.compose",
    });

    // The attachments move from the draft to the message, then the draft goes.
    // In that order: a discarded draft cascades its attachments away, so
    // deleting first would take the files with it.
    if (row.email_draft_id && message) {
      await repo.attachToMessage(client, row.email_draft_id, message.email_message_id);
      await repo.deleteDraft(client, row.user_id, row.email_draft_id);
    }

    await repo.markSent(client, row.email_send_queue_id, message && message.email_message_id);
    await emitEvent(client, {
      eventTypeKey: events.SENT, moduleKey: events.MODULE,
      entityRef: message ? events.msgRef(message.email_message_id) : qRef(row.email_send_queue_id),
      actorUserId: row.user_id || null,
      payload: { to: p.to, subject: p.subject, mailbox: conn.email_address },
    }).catch(() => { /* @silent:storage the message row is the record */ });

    return { id: row.email_send_queue_id, status: "SENT", message_id: message && message.email_message_id };
  } catch (err) {
    const { retryAt, code } = retryPlan(err, row.attempts);
    await repo.markAttemptFailed(client, row.email_send_queue_id, {
      message: err.message, code, retryAt,
    });
    if (!retryAt) {
      // Nobody is watching the composer by now, so the sender is told through
      // the notification bell instead. This event is what it subscribes to.
      await emitEvent(client, {
        eventTypeKey: "email.send.failed", moduleKey: MODULE, entityRef: qRef(row.email_send_queue_id),
        actorUserId: row.user_id || null,
        payload: { to: p.to, subject: p.subject, error: err.message, code },
      }).catch(() => { /* @silent:storage the FAILED row carries the error */ });
    }
    logger.warn({ err, queueId: row.email_send_queue_id, willRetry: Boolean(retryAt) }, "[mail] queued send failed");
    return { id: row.email_send_queue_id, status: retryAt ? "QUEUED" : "FAILED", error: err.message };
  }
}

/** Drain everything due. One bad message never stops the rest. */
async function flush(client, deps = {}, { limit = 20 } = {}) {
  await repo.requeueStalled(client, { maxAttempts: MAX_ATTEMPTS }).catch(() => {
    /* @silent:storage a stalled row is picked up on the next tick instead */
  });
  const due = await repo.claimDue(client, { limit });
  const results = [];
  for (const row of due) {
     
    results.push(await flushOne(client, row, deps));
  }
  return { claimed: due.length, results };
}

async function attachSignature(client, actor, input, html, text) {
  const { rows } = await client.query(
    `SELECT state FROM feature_state WHERE feature_key = 'mail.signatures'`,
  );
  if (!rows[0] || rows[0].state !== "on") return { html, text };
  const signatures = require("../signature/signature.service");
  const resolved = await signatures.resolveFor(client, {
    userId: actor.user_id || null,
    connectionId: input.connectionId,
    language: input.language || null,
    partyLanguage: input.party_language || null,
    repliedMessageLanguage: input.replied_language || null,
    senderUiLanguage: input.ui_language || null,
  });
  return signatures.bake(html, text, resolved);
}

module.exports = {
  MODULE, ATTACH_MAX_BYTES, SECURE_LINK_HINT_BYTES, UNDO_CHOICES, DEFAULT_UNDO_SECONDS, MAX_ATTEMPTS,
  undoSeconds, saveDraft, getDraft, listDrafts, discardDraft,
  assertRoomFor, validateSend, send, cancel, listQueued,
  retryPlan, flushOne, flush,
};
