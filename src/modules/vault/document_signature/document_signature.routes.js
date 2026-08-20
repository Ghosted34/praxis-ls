/**
 * Document signatures (MOD-64). Gated; feature 'signatures'.
 *
 * RBAC maps onto the tenant's fixed five-action vocabulary (0110_rbac.sql):
 *   view    — see signatures and the resolved card menu
 *   approve — SIGN, and revoke
 *
 * `create` and `approve` are deliberately NOT collapsed: drafting a document
 * for signature and attesting to it are different authorities, which is the
 * same reasoning 0110_rbac.sql applies to can_create vs can_approve everywhere
 * else. Creating a signature REQUEST (PR-3) will take `create`; putting your
 * own name on a document takes `approve`.
 */
"use strict";

const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./document_signature.controller");
const validator = require("./document_signature.validator");

const MODULE = "MOD-64";
const router = express.Router();

router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), validator.listQuery, controller.list);
router.get("/menu", requirePermission(MODULE, "view"), validator.menuQuery, controller.menu);
router.get("/stats", requirePermission(MODULE, "view"), controller.stats);
// After /menu and /stats: an :id route declared first would swallow both.
router.get("/:id", requirePermission(MODULE, "view"), controller.get);

router.post("/internal", requirePermission(MODULE, "approve"), validator.signInternal, controller.sign);
router.post("/:id/revoke", requirePermission(MODULE, "approve"), validator.revoke, controller.revoke);

module.exports = { basePath: "/signatures", feature: "signatures", router };
