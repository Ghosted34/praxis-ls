/**
 * Margin simulator (MOD-27) — rapid quote, no GL. Gated per action:
 * view (read + preview + LINK COSTING read), create (save + quote — quoting
 * creates a quotation), edit (submit), approve (approve/reject, maker-checker
 * in the service). §3.1 restored the legacy screen's workflow.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./margin_simulation.controller");
const validator = require("./margin_simulation.validator");

const MODULE = "MOD-27";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
// LINK COSTING (§3.1) — declared before /:id so "from-costing" never parses as an id.
router.get("/from-costing/:costingId", requirePermission(MODULE, "view"), validator.costingParam, controller.fromCosting);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/preview", requirePermission(MODULE, "view"), validator.compute, controller.preview);
router.post("/", requirePermission(MODULE, "create"), validator.compute, controller.create);
// Workflow (§3.1): submitting is the author's act; approving/rejecting is a
// decision (maker-checker enforced in the service); quoting creates a
// quotation, so it carries the same permission as creating one.
// §2.4a — the edit path. Without it a simulation was frozen at creation in
// every status, REJECTED included, so the only response to a rejection was to
// rebuild the document. `edit`, the same grant the costing's PATCH takes.
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.post("/:id/submit", requirePermission(MODULE, "edit"), validator.submit, controller.submit);
router.post("/:id/approve", requirePermission(MODULE, "approve"), validator.idParam, controller.approve);
router.post("/:id/reject", requirePermission(MODULE, "approve"), validator.reject, controller.reject);
router.post("/:id/quote", requirePermission(MODULE, "create"), validator.idParam, controller.quote);

module.exports = { basePath: "/margin-simulations", feature: null, router };
