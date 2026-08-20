/**
 * Conversations: listing, reading, moving, and the per-user state that makes a
 * shared mailbox work.
 *
 * ── WHY "MARK READ" IS NOT A COLUMN UPDATE ──────────────────────────────────
 *
 * It writes a row keyed on (message, user). Two people working billing@ see
 * different unread counts from the same messages, which is the entire reason the
 * model changed. Anything here that looks like it is asking "is this read" and
 * does not carry a user id is a bug.
 *
 * ── SERVER STATE IS BEST-EFFORT, LOCAL STATE IS NOT ─────────────────────────
 *
 * Marking read and moving folders propagate to the mail server so a user's phone
 * agrees with the workspace, but a provider failure must never block the local
 * change: the user pressed the button, the button has to work. The same
 * discipline the engine already applies to markAsRead.
 */
"use strict";

const repo = require("./thread.repo");
const mailRepo = require("./mail.repo");
const access = require("./access");
const search = require("./search");
const events = require("./mail.events");
const { AppError } = require("../../../utils/errors");
const { emitEvent } = require("../../../shared/events/emit");
const { logger } = require("../../../config/logger");

const MODULE = "MOD-72";
const ref = (id) => `email_thread:${id}`;

/** Parse the search box, then hand the structured filters to the repo. */
function queryFrom(q = {}) {
  const parsed = q.q ? search.parseQuery(q.q) : { filters: {}, tsquery: null };
  const f = parsed.filters || {};
  const bool = (v) => (v === undefined || v === null || v === "" ? undefined : v === true || v === "true");
  return {
    connectionId: q.connection_id || undefined,
    folder: (q.folder || f.folder || undefined) && String(q.folder || f.folder).toUpperCase(),
    stream: (q.stream || f.stream || undefined) && String(q.stream || f.stream).toUpperCase(),
    label: q.label || f.label || undefined,
    entityRef: q.entity_ref || undefined,
    vip: bool(q.vip) ?? f.vip ?? undefined,
    unread: bool(q.unread) ?? f.unread ?? undefined,
    starred: bool(q.starred) ?? f.starred ?? undefined,
    hasAttachment: bool(q.has_attachment) ?? f.hasAttachment ?? undefined,
    from: f.from && f.from.length ? f.from : undefined,
    to: f.to && f.to.length ? f.to : undefined,
    subject: f.subject && f.subject.length ? f.subject : undefined,
    before: q.before || f.before || undefined,
    after: f.after || undefined,
    tsquery: parsed.tsquery || undefined,
    limit: q.limit,
  };
}

const list = (client, actor, q = {}) => repo.listThreads(client, actor.user_id, queryFrom(q));

async function get(client, actor, threadId) {
  const t = await repo.getThread(client, actor.user_id, threadId);
  if (!t) throw new AppError("NOT_FOUND", "conversation not found", 404);
  return t;
}

/**
 * Mark a conversation read for the caller, and tell the mail server so their
 * phone agrees. The server call is per message and best-effort.
 */
async function markRead(client, actor, threadId, isRead = true) {
  const thread = await repo.getThread(client, actor.user_id, threadId);
  if (!thread) throw new AppError("NOT_FOUND", "conversation not found", 404);
  const touched = await repo.setThreadRead(client, actor.user_id, threadId, isRead);

  if (isRead) {
    propagateToServer(client, thread, async (adapter, m) => {
      if (m.external_message_id) await adapter.markAsRead(m.external_message_id);
    }, "serverFlags").catch(() => { /* @silent:teardown propagation is best-effort; the local flip already happened */ });
    await emitEvent(client, {
      eventTypeKey: "email.thread.read", moduleKey: MODULE, entityRef: ref(threadId),
      actorUserId: actor.user_id || null, payload: { messages: touched },
    }).catch(() => { /* @silent:storage the read state is the outcome, not its event */ });
  }
  return { email_thread_id: threadId, messages: touched, is_read: isRead };
}

const star = (client, actor, threadId, on = true) =>
  repo.setThreadStarred(client, actor.user_id, threadId, on).then((n) => ({ email_thread_id: threadId, messages: n, is_starred: on }));

/** Move every message in a conversation to a canonical folder. */
async function move(client, actor, threadId, folder) {
  const target = String(folder || "").toUpperCase();
  if (!search.FOLDERS.has(target)) {
    throw new AppError("VALIDATION_ERROR", `folder must be one of ${[...search.FOLDERS].join(", ")}`, 422);
  }
  const thread = await repo.getThread(client, actor.user_id, threadId);
  if (!thread) throw new AppError("NOT_FOUND", "conversation not found", 404);
  await access.assertCanRead(client, thread.email_connection_id, actor.user_id);

  // The destination row must exist before the messages point at it, or the rail
  // cannot draw a folder that now holds mail — which reads as "the mail is gone".
  await repo.ensureCanonicalFolder(client, thread.email_connection_id, target);
  const moved = await repo.moveThread(client, actor.user_id, threadId, target);
  const dest = (await repo.syncableFolders(client, thread.email_connection_id)).find((f) => f.canonical === target);
  if (dest) {
    propagateToServer(client, thread, async (adapter, m) => {
      if (adapter.moveMessage && m.external_message_id) await adapter.moveMessage(m.external_message_id, dest.provider_path);
    }, "folderMove").catch(() => { /* @silent:teardown the local move stands even if the server refuses */ });
  }
  await emitEvent(client, {
    eventTypeKey: "email.message.moved", moduleKey: MODULE, entityRef: ref(threadId),
    actorUserId: actor.user_id || null, payload: { folder: target, messages: moved.length },
  }).catch(() => { /* @silent:storage */ });
  return { email_thread_id: threadId, folder: target, messages: moved.length };
}

/**
 * Run `fn` against the mail server for each message in a thread.
 *
 * Requires the adapter, which requires credentials, which is why it is separated
 * out and always called without awaiting the caller's success on it.
 *
 * `requires` names the capability the operation needs (§3.5). Asking
 * `capabilities()` rather than probing for the METHOD is the difference between
 * "this mailbox type cannot move messages", which the UI can say, and a call
 * that throws inside a best-effort catch and leaves the user staring at a
 * button that appears to work and does nothing. Adapters are told to keep every
 * key present precisely so this check is meaningful.
 */
async function propagateToServer(client, thread, fn, requires = null) {
  const conn = await mailRepo.getConnection(client, thread.email_connection_id);
  if (!conn || conn.status !== "CONNECTED") return { skipped: "not_connected" };
  const { resolveAdapter } = require("./mail.service");
  const adapter = await resolveAdapter(client, conn);
  const caps = typeof adapter.capabilities === "function" ? adapter.capabilities() : {};
  if (requires && caps[requires] !== true) {
    logger.debug({ requires, provider: conn.provider }, "[mail] server propagation not supported by this mailbox");
    return { skipped: requires };
  }
  for (const m of thread.messages || []) {
    try { await fn(adapter, m); }
    catch (err) { logger.debug({ err, message_id: m.email_message_id }, "[mail] server propagation skipped"); }
  }
  return { propagated: (thread.messages || []).length };
}

/**
 * Bulk actions. One verb over many conversations, applied one at a time so a
 * single bad id reports itself instead of failing the batch — a bulk archive
 * that silently does nothing is worse than one that says which two failed.
 */
async function bulk(client, actor, { ids = [], op, folder = null, label_id = null } = {}) {
  if (!Array.isArray(ids) || !ids.length) throw new AppError("VALIDATION_ERROR", "ids are required", 422);
  if (ids.length > 500) throw new AppError("TOO_MANY", "Up to 500 conversations at a time.", 422);
  const done = [];
  const failed = [];
  for (const id of ids) {
    try {
      switch (op) {
        case "read": await markRead(client, actor, id, true); break;
        case "unread": await markRead(client, actor, id, false); break;
        case "star": await star(client, actor, id, true); break;
        case "unstar": await star(client, actor, id, false); break;
        case "move": await move(client, actor, id, folder); break;
        case "label": await repo.applyLabel(client, actor.user_id, id, label_id, true); break;
        case "unlabel": await repo.applyLabel(client, actor.user_id, id, label_id, false); break;
        default: throw new AppError("VALIDATION_ERROR", `unknown bulk op '${op}'`, 422);
      }
      done.push(id);
    } catch (err) {
      failed.push({ email_thread_id: id, error: err.message });
    }
  }
  return { op, succeeded: done.length, failed };
}

/**
 * Correct a stream classification.
 *
 * Recorded as an explicit user decision rather than a silent field write: the
 * classifier got it wrong, and a later pass must not undo the correction.
 */
async function setStream(client, actor, threadId, stream) {
  const target = String(stream || "").toUpperCase();
  if (target !== "HUMAN" && target !== "SYSTEM") {
    throw new AppError("VALIDATION_ERROR", "stream must be HUMAN or SYSTEM", 422);
  }
  const thread = await repo.getThreadById(client, threadId);
  if (!thread) throw new AppError("NOT_FOUND", "conversation not found", 404);
  await access.assertCanRead(client, thread.email_connection_id, actor.user_id);
  const row = await repo.updateThread(client, threadId, {
    stream: target,
    stream_reason: `Moved to ${target === "HUMAN" ? "the main inbox" : "the system stream"} by a person.`,
  });
  await emitEvent(client, {
    eventTypeKey: "email.stream.corrected", moduleKey: MODULE, entityRef: ref(threadId),
    actorUserId: actor.user_id || null, payload: { stream: target, was: thread.stream },
  }).catch(() => { /* @silent:storage */ });
  return row;
}

/**
 * Put a label on a conversation, or take it off.
 *
 * Labels are PERSONAL: `email_label.owner_user_id` scopes them, and the repo
 * query joins on that owner, so one person cannot tag a conversation with
 * another person's label — nor see that they did. The repo also re-checks that
 * the conversation is one the caller may read, which is why this returns a
 * boolean rather than a row: a false means "nothing matched", which covers both
 * "not your label" and "not your conversation" without telling the caller which.
 */
async function applyLabel(client, actor, threadId, labelId, on = true) {
  if (!labelId) throw new AppError("VALIDATION_ERROR", "label_id is required", 422);
  const changed = await repo.applyLabel(client, actor.user_id, threadId, labelId, on);
  if (!changed && on) throw new AppError("NOT_FOUND", "conversation or label not found", 404);
  return { email_thread_id: threadId, email_label_id: labelId, applied: on };
}

/**
 * The folder rail, in one round trip: the folders with the caller's unread
 * counts, plus the two stream totals.
 *
 * Returned together rather than as two endpoints because they are drawn as one
 * thing and a rail whose halves arrive separately flickers through a state
 * where the numbers disagree.
 */
async function folders(client, actor, connectionId) {
  const [list, streams] = await Promise.all([
    repo.listFolders(client, connectionId || null, actor.user_id),
    repo.streamUnread(client, actor.user_id, connectionId || null),
  ]);
  return { folders: list, streams };
}
const labels = (client, actor) => repo.listLabels(client, actor.user_id);
const createLabel = (client, actor, body) => repo.createLabel(client, actor.user_id, body);
const deleteLabel = (client, actor, id) => repo.deleteLabel(client, actor.user_id, id);
const timeline = (client, actor, { entity_ref, client_id, limit } = {}) =>
  repo.timelineByEntity(client, entity_ref || `client:${client_id}`, { limit, userId: actor && actor.user_id });

module.exports = {
  MODULE, queryFrom, list, get, markRead, star, move, bulk, setStream, applyLabel,
  folders, labels, createLabel, deleteLabel, timeline,
  // Exported for the capability gate's test — it is the one place that decides
  // whether an operation reaches the mail server at all (§3.5).
  propagateToServer,
};
