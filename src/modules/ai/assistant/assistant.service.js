/**
 * Assistant module service — thin wrapper over the AI orchestrator so the module
 * boundary stays clean (controllers depend on this, not on services/ai/* directly).
 */
"use strict";
const orchestrator = require("../../../services/ai/orchestrator.service");
const repo = require("./assistant.repo");
const { buildExecutorMap } = require("../../../services/ai/action-registrar");
const { rowsToOptions } = require("../../../services/ai/action-fields");
const { AppError } = require("../../../utils/errors");

// Executor map is auto-derived from every module manifest (reads) + the vetted
// write registry. Built once at load; a manifest change requires a restart, same
// as the catalogue sync.
const registry = buildExecutorMap();

const ask = (client, { user, message, conversationId, allowed, mode, scope }) =>
  orchestrator.ask({ client, user, message, conversationId, allowed, registry, mode, scope });

/**
 * Streaming ask — returns an async generator of SSE events. The controller
 * pipes these to the response as `text/event-stream`. The registry is the same
 * shared executor map; nothing about streaming changes what can be executed.
 */
const askStream = (client, { user, message, conversationId, allowed, mode, scope }) =>
  orchestrator.askStream({ client, user, message, conversationId, allowed, registry, mode, scope });

const confirm = (client, { user, actionRunId, payload, allowed }) =>
  orchestrator.confirmAction({ client, user, actionRunId, registry, payload, allowed });

/**
 * Options for an interactive form's reference dropdown. `ref` must be an
 * ai_enabled READ in the catalogue (so it respects the AI gate), and it runs
 * with the caller's client — the picker can never surface rows the user's RBAC
 * would hide. Rows are mapped to {value,label} for the select.
 */
async function options(client, { user, ref, q, limit }) {
  if (!ref) throw new Error("ref is required");
  const { rows } = await client.query(
    "SELECT 1 FROM ai_action_catalogue WHERE action_key=$1 AND is_write=false AND ai_enabled=true",
    [ref],
  );
  if (!rows.length) throw new Error(`unknown or disabled options source: ${ref}`);
  const fn = registry[ref];
  if (typeof fn !== "function") throw new Error(`no executor for ${ref}`);
  const out = await fn({ client, user, payload: { limit: Math.min(limit || 100, 500), q: q || undefined } });
  return rowsToOptions(out && out.data !== undefined ? out.data : out, Math.min(limit || 100, 500));
}

const confirmBatch = (client, { user, batchId, allowed }) =>
  orchestrator.confirmBatch({ client, user, batchId, registry, allowed });

/**
 * The signed-in user's thread, for the copilot to render when it opens.
 * Always scoped to req.user — a conversation is private to the person who had
 * it, and there is no cross-user read path by design.
 */
async function history(client, { user, conversationId, limit }) {
  // A requested thread must belong to the caller; otherwise fall back to their
  // current one (never read another user's conversation).
  let id = conversationId || null;
  if (id && !(await repo.conversationBelongsToUser(client, id, user.user_id))) id = null;
  if (!id) id = await repo.currentConversation(client, user.user_id);
  const messages = await repo.listMessages(client, id, limit || 200);
  return { conversation_id: id, messages };
}

/** The caller's threads for the history sidebar (metadata only, pinned first). */
async function conversations(client, { user, limit, includeArchived }) {
  return repo.listConversations(client, user.user_id, {
    limit: Math.min(limit || 50, 200),
    includeArchived: includeArchived === true,
  });
}

/**
 * Start a fresh thread. Does not delete the old one — "new conversation" means
 * put this one down, and the rail is where you pick it back up. Removing a
 * thread is `removeConversation` below, which is a different gesture with a
 * different control.
 */
async function clearHistory(client, { user }) {
  const conversationId = await repo.startNewConversation(client, user.user_id);
  return { conversation_id: conversationId, messages: [] };
}

// ── Conversation management (audit J1-J3) ───────────────────────────────────
//
// WHY EVERY ONE OF THESE 404s RATHER THAN 403. The repo statements are scoped
// with `AND user_id = $2`, so a thread that is not the caller's matches nothing
// and is indistinguishable here from one that does not exist. That is the
// correct answer to give as well as the only one available: replying 403 to a
// conversation id would confirm the id belongs to SOMEBODY, which is a fact
// about another user's history.
//
// There is no RBAC beyond auth on any of them, for the same reason `history`
// has none — a conversation is private to the person who had it and there is no
// path in the module that reads anyone else's.

const NOT_FOUND = () => new AppError("NOT_FOUND", "Conversation not found", 404);

/**
 * Pin, rename or archive the caller's own thread. Only the keys present in
 * `patch` are touched.
 *
 * Answers with the row in the rail's own shape (`repo.conversationMeta`) rather
 * than `{ ok: true }`, so the client patches the row it has instead of
 * refetching the whole list — and so a cleared title comes back as the DERIVED
 * one, which is the thing the rail must draw and the raw column does not carry.
 */
async function updateConversation(client, { user, conversationId, patch }) {
  const ok = await repo.updateConversation(client, conversationId, user.user_id, patch || {});
  if (!ok) throw NOT_FOUND();
  return repo.conversationMeta(client, conversationId, user.user_id);
}

/**
 * Remove a thread: soft by default, `purge` for the irreversible one.
 *
 * THE TWO ARE ONE ENDPOINT ON PURPOSE. They are the same intent at two
 * strengths, and the difference is a decision the USER makes in the confirm
 * dialog ("also erase it permanently"), not a different feature. Splitting them
 * into two routes would mean the client picking a URL from a checkbox, and
 * would make it possible to ship the soft one and forget the hard one — which
 * is precisely the half-measure J1 is about: a delete that only hides.
 *
 * A purge on an already soft-deleted thread is the normal second step and must
 * work, so it does not go through the soft path first.
 */
async function removeConversation(client, { user, conversationId, purge }) {
  const ok = purge === true
    ? await repo.purgeConversation(client, conversationId, user.user_id)
    : await repo.softDeleteConversation(client, conversationId, user.user_id);
  if (!ok) throw NOT_FOUND();
  return { conversation_id: conversationId, purged: purge === true };
}

module.exports = {
  ask,
  askStream,
  confirm,
  confirmBatch,
  history,
  conversations,
  clearHistory,
  options,
  updateConversation,
  removeConversation,
};
