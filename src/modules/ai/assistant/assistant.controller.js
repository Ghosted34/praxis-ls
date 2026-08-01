"use strict";
const service = require("./assistant.service");
const { asyncHandler } = require("../../../utils/errors");
const user = (req) => req.user || { user_id: null };

const ask = asyncHandler(async (req, res) => {
  const out = await req.tenantDb((client) =>
    service.ask(client, {
      user: user(req),
      message: req.body.message,
      conversationId: req.body.conversation_id,
      allowed: req.aiAllowed || ["normal"],
    }),
  );
  res.json({ data: out });
});
const confirm = asyncHandler(async (req, res) => {
  const out = await req.tenantDb((client) =>
    service.confirm(client, { user: user(req), actionRunId: req.params.id }),
  );
  res.json({ data: out });
});
const confirmBatch = asyncHandler(async (req, res) => {
  const out = await req.tenantDb((client) =>
    service.confirmBatch(client, { user: user(req), batchId: req.params.batchId }),
  );
  res.json({ data: out });
});
const history = asyncHandler(async (req, res) => {
  const out = await req.tenantDb((client) =>
    service.history(client, { user: user(req), limit: Math.min(Number(req.query.limit) || 200, 500) }),
  );
  res.json({ data: out });
});
const clearHistory = asyncHandler(async (req, res) => {
  const out = await req.tenantDb((client) => service.clearHistory(client, { user: user(req) }));
  res.json({ data: out });
});

module.exports = { ask, confirm, confirmBatch, history, clearHistory };
