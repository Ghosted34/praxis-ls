/** Office expenses (MOD-77). Gated; feature finance.office_expenses (off by default).
 *  Posting requires `approve` — the maker-checker split described in the service. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./office_expense.controller");
const validator = require("./office_expense.validator");

const MODULE = "MOD-77";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/totals", requirePermission(MODULE, "view"), controller.totals);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.post("/:id/post", requirePermission(MODULE, "approve"), validator.post, controller.post);
router.delete("/:id", requirePermission(MODULE, "delete"), controller.remove);

module.exports = { basePath: "/office-expenses", feature: "finance.office_expenses", router };
