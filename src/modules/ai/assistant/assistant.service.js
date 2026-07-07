/**
 * Assistant module service — thin wrapper over the AI orchestrator so the module
 * boundary stays clean (controllers depend on this, not on services/ai/* directly).
 */
"use strict";
const orchestrator = require("../../../services/ai/orchestrator.service");
const { registry } = require("../../../services/ai/action-registry");

const ask = (client, { user, message, conversationId, allowed }) =>
  orchestrator.ask({ client, user, message, conversationId, allowed });

const confirm = (client, { user, actionRunId }) =>
  orchestrator.confirmAction({ client, user, actionRunId, registry });

module.exports = { ask, confirm };
