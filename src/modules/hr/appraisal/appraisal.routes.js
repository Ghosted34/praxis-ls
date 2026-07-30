/** Appraisal routes — RBAC-gated (MOD-13) + feature "hr.appraisals". */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./appraisal.controller");
const validator = require("./appraisal.validator");

const M = "MOD-13";
const router = express.Router();
router.use(authMiddleware);

// Self-service — the caller's own appraisals (My HR). No MOD grant.
router.get("/mine", controller.mine);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.post("/:id/reward", requirePermission(M, "approve"), validator.reward, controller.reward);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/appraisals", feature: "hr.appraisals", router };
