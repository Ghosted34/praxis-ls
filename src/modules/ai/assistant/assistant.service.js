/**
 * Assistant module service — thin wrapper over the AI orchestrator so the module
 * boundary stays clean (controllers depend on this, not on services/ai/* directly).
 */
"use strict";
const orchestrator = require("../../../services/ai/orchestrator.service");
const repo = require("./assistant.repo");
const { buildExecutorMap } = require("../../../services/ai/action-registrar");
const { rowsToOptions } = require("../../../services/ai/action-fields");

// Executor map is auto-derived from every module manifest (reads) + the vetted
// write registry. Built once at load; a manifest change requires a restart, same
// as the catalogue sync.
const registry = buildExecutorMap();

const ask = (client, { user, message, conversationId, allowed }) =>
  orchestrator.ask({ client, user, message, conversationId, allowed, registry });

const confirm = (client, { user, actionRunId, payload }) =>
  orchestrator.confirmAction({ client, user, actionRunId, registry, payload });

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

const confirmBatch = (client, { user, batchId }) =>
  orchestrator.confirmBatch({ client, user, batchId, registry });

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

/** The caller's threads for the history sidebar (metadata only, newest first). */
async function conversations(client, { user, limit }) {
  return repo.listConversations(client, user.user_id, Math.min(limit || 50, 200));
}

/**
 * Start a fresh thread. Does not delete the old one — retention is "keep
 * indefinitely" for now, and ai_action_run rows reference conversation_id, so
 * deleting would strip the audit trail of what the assistant was asked to do.
 */
async function clearHistory(client, { user }) {
  const conversationId = await repo.startNewConversation(client, user.user_id);
  return { conversation_id: conversationId, messages: [] };
}

module.exports = { ask, confirm, confirmBatch, history, conversations, clearHistory, options };
