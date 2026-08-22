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
const { emitEvent, audit } = require("../../../shared/events/emit");
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
    client: f.client || undefined,
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
        case "delete": await remove(client, actor, id); break;
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

/* ── Deletion (H-1) ────────────────────────────────────────────────────────
 *
 * There was no deletion path anywhere in this module. The bulk verb list ran
 * read/unread/star/unstar/move/label/unlabel, Trash accumulated forever, the
 * provider's Trash was never emptied, and §9.6's promise that "deletion of an
 * archived message is blocked in the service layer" was vacuous — nothing could
 * delete anything, so nothing needed blocking.
 *
 * The shape below makes that promise real rather than removing it:
 *
 *  - A SEALED message is never deleted. `email_archive` covers its body hash and
 *    its attachment hashes, and the chain is a linked list — removing a link
 *    breaks verification for every message after it, which is the one thing the
 *    archive exists to prevent. The database enforces this too (the archive's FK
 *    to `email_message` has no ON DELETE), but relying on a 23503 would surface
 *    as a 500 and tell the user nothing.
 *  - A BLOCKED attempt is ledgered, not silently skipped. "I tried to delete
 *    correspondence that is under retention" is exactly the event a retention
 *    control exists to record, and it is more interesting than the successes.
 *  - Deletion is per-caller-visible. The predicate rides inside the DELETE, not
 *    only on the route gate, so a thread made PRIVATE between the two is
 *    refused by the statement.
 *  - The provider is told, best-effort. A message deleted here and left on the
 *    IMAP server comes back on the next sync, which reads as the product
 *    ignoring the user.
 */

/** Messages this caller may see on the thread, with the sealed ones identified. */
async function deletionPlan(client, actor, threadId) {
  const thread = await repo.headIfVisible(client, actor.user_id, threadId);
  if (!thread) throw new AppError("NOT_FOUND", "conversation not found", 404);
  const full = await repo.getThread(client, actor.user_id, threadId);
  const ids = ((full && full.messages) || []).map((m) => m.email_message_id);
  const sealed = ids.length ? await repo.archivedMessageIds(client, ids) : [];
  return { thread, full, ids, sealed };
}

/**
 * Delete one conversation. Returns what was removed and what was retained,
 * because "some of this is under retention and stays" is a fact the user has to
 * be told rather than a detail to hide behind a success toast.
 */
async function remove(client, actor, threadId) {
  const { thread, full, ids, sealed } = await deletionPlan(client, actor, threadId);

  if (sealed.length) {
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: "mail.message.delete_blocked",
      moduleKey: MODULE,
      entityRef: ref(threadId),
      isSensitive: true,
      metadata: { sealed: sealed.length, of: ids.length, reason: "archived_under_retention" },
    }).catch(() => { /* @silent:storage the refusal below is the outcome */ });
  }

  const deleted = await repo.deleteThreadMessages(client, actor.user_id, threadId, { skipIds: sealed });

  // Nothing was deletable and something was there: say so, with the reason.
  if (!deleted.length && sealed.length) {
    throw new AppError(
      "ARCHIVED_RETENTION",
      sealed.length === ids.length
        ? "Every message on this conversation is sealed into the compliance archive and cannot be deleted."
        : "The messages on this conversation are sealed into the compliance archive and cannot be deleted.",
      409,
    );
  }

  // Only when the thread is genuinely empty. A thread row removed while sealed
  // messages still hang off it would orphan them from their own conversation —
  // and the archive FK would refuse the cascade anyway, as a 500.
  let threadRemoved = false;
  if (!sealed.length) {
    const gone = await client.query(
      `DELETE FROM email_thread t
        WHERE t.email_thread_id = $1
          AND NOT EXISTS (SELECT 1 FROM email_message m WHERE m.email_thread_id = t.email_thread_id)
        RETURNING t.email_thread_id`,
      [threadId],
    );
    threadRemoved = gone.rows.length > 0;
  }

  await propagateToServer(
    client,
    { ...full, messages: deleted },
    (adapter, m) => adapter.deleteMessage(m.external_message_id, m.provider_folder),
    "serverDelete",
  ).catch((err) => {
    logger.debug({ err, thread_id: threadId }, "[mail] provider delete skipped");
    return null;
  });

  await audit(client, {
    actorUserId: actor.user_id || null,
    action: "mail.thread.deleted",
    moduleKey: MODULE,
    entityRef: ref(threadId),
    isSensitive: true,
    before: { subject: thread.subject, messages: ids.length },
    metadata: { deleted: deleted.length, retained_archived: sealed.length, thread_removed: threadRemoved },
  }).catch(() => { /* @silent:storage the delete is the outcome */ });

  await emitEvent(client, {
    eventTypeKey: "email.thread.deleted", moduleKey: MODULE, entityRef: ref(threadId),
    actorUserId: actor.user_id || null,
    payload: { deleted: deleted.length, retained_archived: sealed.length },
  }).catch(() => { /* @silent:storage */ });

  return {
    email_thread_id: threadId,
    deleted: deleted.length,
    retained_archived: sealed.length,
    thread_removed: threadRemoved,
  };
}

/**
 * Empty a folder — the "Empty Trash" the product did not have.
 *
 * Restricted to TRASH and SPAM by name. "Empty INBOX" is not a feature anyone
 * asked for and is the sort of thing that reaches production as a typo'd
 * parameter; an allow-list costs nothing and removes the class.
 */
const EMPTIABLE = new Set(["TRASH", "SPAM"]);

async function emptyFolder(client, actor, folder) {
  const target = String(folder || "").toUpperCase();
  if (!EMPTIABLE.has(target)) {
    throw new AppError("VALIDATION_ERROR", "Only Trash and Spam can be emptied.", 422);
  }
  const rows = await repo.messagesInFolder(client, actor.user_id, target);
  const threadIds = [...new Set(rows.map((r) => r.email_thread_id))];

  let deleted = 0;
  let retained = 0;
  const failed = [];
  for (const id of threadIds) {
    try {
      const out = await remove(client, actor, id);
      deleted += out.deleted;
      retained += out.retained_archived;
    } catch (err) {
      // One thread under retention must not abort the other 400. The count of
      // what stayed is reported; the archive's refusal is not a failure of the
      // operation, it is the operation working.
      if (err.code === "ARCHIVED_RETENTION") retained += 1;
      else failed.push({ email_thread_id: id, error: err.message });
    }
  }

  await audit(client, {
    actorUserId: actor.user_id || null,
    action: "mail.folder.emptied",
    moduleKey: MODULE,
    entityRef: `email_folder:${target}`,
    isSensitive: true,
    metadata: { folder: target, threads: threadIds.length, deleted, retained_archived: retained },
  }).catch(() => { /* @silent:storage */ });

  return { folder: target, threads: threadIds.length, deleted, retained_archived: retained, failed };
}

module.exports = {
  MODULE, queryFrom, list, get, markRead, star, move, bulk, setStream, applyLabel,
  folders, labels, createLabel, deleteLabel, timeline,
  remove, emptyFolder,
  // Exported for the capability gate's test — it is the one place that decides
  // whether an operation reaches the mail server at all (§3.5).
  propagateToServer,
};
