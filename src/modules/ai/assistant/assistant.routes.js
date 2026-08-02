/** AI assistant surface (/api/tenant/ai). Auth + ai.assistant.backend feature;
 *  governance.canUseFeature is re-checked inside the orchestrator. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const c = require("./assistant.controller");
const { validate } = require("./assistant.validator");

const router = express.Router();
router.use(authMiddleware);
router.post("/ask", validate("ask"), c.ask);
// Conversation history — always the CALLER's own thread (scoped to req.user in
// the service), so no RBAC beyond auth: there is no path to read anyone else's.
router.get("/conversations", c.conversations);
router.get("/history", c.history);
router.post("/history/clear", c.clearHistory);
router.post("/actions/:id/confirm", c.confirm);
router.post("/batches/:batchId/confirm", c.confirmBatch);

module.exports = { basePath: "/ai", feature: "ai.assistant.backend", router };
