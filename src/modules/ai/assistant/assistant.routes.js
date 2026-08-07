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
router.get("/options", c.options);
router.get("/history", c.history);
router.post("/history/clear", c.clearHistory);
router.post("/actions/:id/confirm", validate("confirm"), c.confirm);
router.post("/batches/:batchId/confirm", c.confirmBatch);
// Excel export of an answer's tables. POST because the tables ARE the payload —
// they were never persisted, so there is no id to GET them by. Reads nothing,
// so auth + the feature gate on this router are the whole access story.
router.post("/export/tables", validate("exportTables"), c.exportTables);

module.exports = { basePath: "/ai", feature: "ai.assistant.backend", router };
