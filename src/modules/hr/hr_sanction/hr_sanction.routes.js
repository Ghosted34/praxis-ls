/**
 * HR sanctions. Self view for the employee (their own record), HR-managed
 * otherwise (MOD-71; CEO bypasses). /mine registered before /:id.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./hr_sanction.controller");
const validator = require("./hr_sanction.validator");

const M = "MOD-71";
const router = express.Router();
router.use(authMiddleware);

router.get("/mine", controller.mine);

router.get("/", requirePermission(M, "view"), controller.list);
router.post("/", requirePermission(M, "create"), validator.create, controller.create);
router.get("/:id", requirePermission(M, "view"), controller.get);
router.patch("/:id", requirePermission(M, "edit"), validator.update, controller.update);
router.post("/:id/lift", requirePermission(M, "edit"), controller.lift);
router.delete("/:id", requirePermission(M, "delete"), controller.archive);

module.exports = { basePath: "/hr/sanctions", feature: null, router };
