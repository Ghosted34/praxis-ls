/** AI assistant surface (/api/tenant/ai). Auth + ai.assistant.backend feature;
 *  governance.canUseFeature is re-checked inside the orchestrator. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { makeLimiter } = require("../../../shared/http/rate-limit");
const c = require("./assistant.controller");
const { validate } = require("./assistant.validator");

/**
 * Rate limiter for AI ask endpoints (audit 3.2).
 *
 * 20 requests per minute per user. Each ask can trigger 2–4 LLM API calls
 * (embedding + chat + read narration + anti-stall nudge), so this is the
 * cost-control layer below the governance budget cap. A user who hits this
 * limit is either scripting against the endpoint or stuck in a retry loop —
 * neither should burn the tenant's budget.
 *
 * Keyed by user_id rather than IP: the same office behind NAT is many users,
 * and the same user on mobile + desktop is one budget. The budget period's
 * hard cap is the last line of defense; this is the first.
 */
const aiAskLimiter = makeLimiter({
  name: "ai-ask",
  max: 20,
  windowMs: 60 * 1000,
  keyGenerator: (req) => `ai:${req.user && req.user.user_id ? req.user.user_id : req.ip}`,
});

const router = express.Router();
router.use(authMiddleware);
router.post("/ask", aiAskLimiter, validate("ask"), c.ask);
// Streaming variant — SSE (text/event-stream). Same body schema as /ask.
// Mounted BEFORE the catch-all because express matches in order; /ask/stream
// must not be consumed by a wildcard /ask/:id route.
router.post("/ask/stream", aiAskLimiter, validate("ask"), c.askStream);
// Conversation history — always the CALLER's own thread (scoped to req.user in
// the service), so no RBAC beyond auth: there is no path to read anyone else's.
router.get("/conversations", c.conversations);
router.get("/options", c.options);
router.get("/history", c.history);
router.post("/history/clear", c.clearHistory);
router.post("/actions/:id/confirm", validate("confirm"), c.confirm);
router.post("/batches/:batchId/confirm", c.confirmBatch);
// User feedback on AI answers (thumbs up/down). Drives the self-improvement
// loop — bad answers with comments are injected into the system prompt as
// "PATTERNS USERS DISLIKED" so the model avoids repeating known mistakes.
router.post("/feedback", validate("feedback"), c.feedback);
// Excel export of an answer's tables. POST because the tables ARE the payload —
// they were never persisted, so there is no id to GET them by. Reads nothing,
// so auth + the feature gate on this router are the whole access story.
router.post("/export/tables", validate("exportTables"), c.exportTables);

module.exports = { basePath: "/ai", feature: "ai.assistant.backend", router };
