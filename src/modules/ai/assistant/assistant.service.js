/**
 * Assistant module service — thin wrapper over the AI orchestrator so the module
 * boundary stays clean (controllers depend on this, not on services/ai/* directly).
 */
"use strict";
const orchestrator = require("../../../services/ai/orchestrator.service");
const repo = require("./assistant.repo");
const { buildExecutorMap } = require("../../../services/ai/action-registrar");

// Executor map is auto-derived from every module manifest (reads) + the vetted
// write registry. Built once at load; a manifest change requires a restart, same
// as the catalogue sync.
const registry = buildExecutorMap();

const ask = (client, { user, message, conversationId, allowed }) =>
  orchestrator.ask({ client, user, message, conversationId, allowed });

const confirm = (client, { user, actionRunId }) =>
  orchestrator.confirmAction({ client, user, actionRunId, registry });

const confirmBatch = (client, { user, batchId }) =>
  orchestrator.confirmBatch({ client, user, batchId, registry });

/**
 * The signed-in user's thread, for the copilot to render when it opens.
 * Always scoped to req.user — a conversation is private to the person who had
 * it, and there is no cross-user read path by design.
 */
async function history(client, { user, limit }) {
  const conversationId = await repo.currentConversation(client, user.user_id);
  const messages = await repo.listMessages(client, conversationId, limit || 200);
  return { conversation_id: conversationId, messages };
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

module.exports = { ask, confirm, confirmBatch, history, clearHistory };
