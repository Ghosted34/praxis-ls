"use strict";
const service = require("./assistant.service");
const { asyncHandler } = require("../../../utils/errors");
const { buildTablesWorkbook } = require("./assistant.export");
const user = (req) => req.user || { user_id: null };

/**
 * Answer tables → one .xlsx, one sheet per table.
 *
 * No `req.tenantDb`: this reads nothing. The rows arrive in the body because
 * they were already rendered to this caller, under their own permissions, in an
 * answer the orchestrator produced. The endpoint formats what they can see.
 */
const exportTables = asyncHandler(async (req, res) => {
  const buf = await buildTablesWorkbook(req.body.tables);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="praxis-ai-${stamp}.xlsx"`);
  res.setHeader("Content-Length", buf.length);
  res.send(buf);
});

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
    service.confirm(client, { user: user(req), actionRunId: req.params.id, payload: req.body && req.body.payload }),
  );
  res.json({ data: out });
});
const options = asyncHandler(async (req, res) => {
  const out = await req.tenantDb((client) =>
    service.options(client, { user: user(req), ref: req.query.ref, q: req.query.q, limit: Number(req.query.limit) || 100 }),
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
    service.history(client, {
      user: user(req),
      conversationId: req.query.conversation_id || null,
      limit: Math.min(Number(req.query.limit) || 200, 500),
    }),
  );
  res.json({ data: out });
});
const conversations = asyncHandler(async (req, res) => {
  const out = await req.tenantDb((client) =>
    service.conversations(client, { user: user(req), limit: Math.min(Number(req.query.limit) || 50, 200) }),
  );
  res.json({ data: out });
});
const clearHistory = asyncHandler(async (req, res) => {
  const out = await req.tenantDb((client) => service.clearHistory(client, { user: user(req) }));
  res.json({ data: out });
});

module.exports = { ask, confirm, confirmBatch, history, conversations, clearHistory, options, exportTables };
