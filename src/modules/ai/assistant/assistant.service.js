/**
 * Assistant module service — thin wrapper over the AI orchestrator so the module
 * boundary stays clean (controllers depend on this, not on services/ai/* directly).
 */
"use strict";
const orchestrator = require("../../../services/ai/orchestrator.service");
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

module.exports = { ask, confirm, confirmBatch };
