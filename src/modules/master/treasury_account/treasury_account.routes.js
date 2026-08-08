/**
 * Treasury accounts (MOD-09) + payment gateways (2.3), gated. Two sub-routers
 * under one module so external URLs stay clean without a new module dir:
 *   /treasury-accounts/*  — bank/cash/MoMo accounts (extended in 0519 revamp)
 *   /payment-gateways/*   — per-tenant gateway config, credentials write-only
 * Both ride the same MOD-09 permission (money-in config).
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./treasury_account.controller");
const validator = require("./treasury_account.validator");

const MODULE = "MOD-09";

const treasuryRouter = express.Router();
treasuryRouter.use(authMiddleware);
treasuryRouter.get("/", requirePermission(MODULE, "view"), controller.list);
treasuryRouter.get("/:id", requirePermission(MODULE, "view"), controller.get);
treasuryRouter.get("/:id/360", requirePermission(MODULE, "view"), controller.dossier);
treasuryRouter.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
treasuryRouter.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
treasuryRouter.post("/:id/active",  requirePermission(MODULE, "edit"), validator.setActive, controller.setActive);
treasuryRouter.post("/:id/primary", requirePermission(MODULE, "edit"), controller.setPrimary);
treasuryRouter.post("/:id/verify",  requirePermission(MODULE, "edit"), controller.verify);
treasuryRouter.post("/:id/unverify",requirePermission(MODULE, "edit"), controller.unverify);

const gatewayRouter = express.Router();
gatewayRouter.use(authMiddleware);
gatewayRouter.get("/", requirePermission(MODULE, "view"), controller.listGateways);
gatewayRouter.get("/:provider", requirePermission(MODULE, "view"), controller.getGateway);
gatewayRouter.post("/", requirePermission(MODULE, "edit"), validator.gatewayUpsert, controller.upsertGateway);
gatewayRouter.patch("/:provider/active", requirePermission(MODULE, "edit"), validator.gatewayActive, controller.setGatewayActive);
gatewayRouter.patch("/:provider/role",   requirePermission(MODULE, "edit"), validator.gatewayRole,   controller.setGatewayRole);
gatewayRouter.delete("/:provider", requirePermission(MODULE, "delete"), controller.deleteGateway);

const router = express.Router();
router.use("/treasury-accounts", treasuryRouter);
router.use("/payment-gateways", gatewayRouter);

module.exports = { basePath: "/", feature: null, router };
