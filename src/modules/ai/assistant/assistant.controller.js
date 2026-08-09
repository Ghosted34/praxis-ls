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

/**
 * SSE streaming ask — the answer renders word-by-word in the client instead of
 * waiting 5–15 seconds for the full completion. This is the single biggest UX
 * improvement: first-token latency drops from seconds to ~500ms.
 *
 * Protocol: `text/event-stream`, one `data: {json}\n\n` per event. Event types:
 *   delta, status, reset, answer, actions, sources, trace, done, error.
 * `status` and `reset` carry the assistant's working-out rather than its reply:
 * status is an ephemeral "what I am doing now" line, and reset tells the client
 * that what it has rendered so far was narration and should be taken back.
 * The client's `askPraxisStream` in `ai-api.ts` consumes this and updates the
 * thread incrementally.
 *
 * WHY SSE AND NOT WEBSOCKETS. The existing realtime layer uses Socket.IO for
 * push notifications, but streaming an answer is a request-response pattern —
 * the client asks, the server answers. SSE is simpler (no upgrade, no bidi),
 * works over HTTP/2, and auto-reconnects in browsers. Socket.IO would mean
 * multiplexing chat over the same socket as notifications, which is a coupling
 * the product does not need.
 *
 * WHY `req.tenantDb` WRAPS THE WHOLE GENERATOR. Each event needs the tenant
 * client for reads/writes during tool execution. Rather than acquiring/releasing
 * per event (which would drop the connection between events), we hold it for the
 * full stream and release when the generator completes or the client disconnects.
 */
const askStream = async (req, res) => {
  // SSE headers — must be set before any data is written.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // nginx: don't buffer SSE
  res.flushHeaders();

  // Heartbeat every 15s to prevent proxy/CDN idle timeouts.
  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { /* client gone */ }
  }, 15000);

  // Detect client disconnect (browser tab closed, navigation).
  let aborted = false;
  req.on("close", () => { aborted = true; clearInterval(heartbeat); });

  const sendEvent = (event) => {
    if (aborted) return;
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      aborted = true;
    }
  };

  try {
    // `req.tenantDb` acquires the tenant connection for the generator's lifetime.
    // The generator itself is consumed inside the callback so the connection is
    // held until all events are emitted or the client disconnects.
    await req.tenantDb(async (client) => {
      const stream = service.askStream(client, {
        user: user(req),
        message: req.body.message,
        conversationId: req.body.conversation_id,
        allowed: req.aiAllowed || ["normal"],
      });
      for await (const event of stream) {
        if (aborted) break;
        sendEvent(event);
      }
    });
  } catch (err) {
    sendEvent({ type: "error", message: err.message || "Internal error" });
  } finally {
    clearInterval(heartbeat);
    if (!aborted) {
      try { res.end(); } catch { /* already closed */ }
    }
  }
};
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

/**
 * Record user feedback on an AI answer (thumbs up/down).
 *
 * This is the self-improvement loop: bad answers are stored with the question,
 * the answer, and any comment. Periodically reviewed to tune the system prompt.
 * Good answers are also stored — they reinforce what works and provide positive
 * examples for future prompt tuning.
 *
 * The feedback is also injected into the system prompt as "PATTERNS USERS
 * DISLIKED" when there are recent down-votes with comments — so the model
 * actively avoids repeating known mistakes.
 */
const feedback = asyncHandler(async (req, res) => {
  const { conversation_id, message_id, question, answer, vote, comment, action_keys } = req.body;
  const userId = (req.user && req.user.user_id) || null;
  await req.tenantDb(async (client) => {
    await client.query(
      `INSERT INTO ai_answer_feedback
         (conversation_id, message_id, user_id, question_text, answer_text, vote, comment, action_keys)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [conversation_id || null, message_id || null, userId, question || null, answer || null, vote, comment || null, action_keys || null],
    );
  });
  res.json({ data: { ok: true } });
});

module.exports = { ask, askStream, confirm, confirmBatch, history, conversations, clearHistory, options, exportTables, feedback };
