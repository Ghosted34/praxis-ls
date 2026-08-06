/** Client categories (MOD-03) — CRUD + management (§6.2). Gated. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { controller } = require("./client_type.repo");

const MODULE = "MOD-03";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), controller.update);
router.delete("/:id", requirePermission(MODULE, "delete"), controller.remove);

module.exports = { basePath: "/client-types", feature: null, router };
