/** Wet signatures (MOD-64). Gated; feature 'signatures.wet'. */
"use strict";

const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./signature_wet.controller");
const validator = require("./signature_wet.validator");

const MODULE = "MOD-64";
const router = express.Router();

router.use(authMiddleware);

router.post("/print-jobs", requirePermission(MODULE, "create"), validator.issue, controller.issue);
router.get("/print-jobs/:id/barcode", requirePermission(MODULE, "view"), controller.barcode);
router.post("/print-jobs/:id/printed", requirePermission(MODULE, "create"), validator.empty, controller.markPrinted);
router.post("/print-jobs/:id/reprint", requirePermission(MODULE, "create"), validator.empty, controller.reprint);

router.post("/ingest", requirePermission(MODULE, "create"), validator.ingest, controller.ingest);
router.get("/ingest/queue", requirePermission(MODULE, "view"), validator.listQuery, controller.queue);
router.post("/ingest/:id/decode", requirePermission(MODULE, "create"), validator.decode, controller.decode);
router.post("/ingest/:id/bind", requirePermission(MODULE, "approve"), validator.bind, controller.bind);
router.post("/ingest/:id/reject", requirePermission(MODULE, "approve"), validator.reject, controller.reject);

module.exports = { basePath: "/signatures", feature: "signatures.wet", router };
