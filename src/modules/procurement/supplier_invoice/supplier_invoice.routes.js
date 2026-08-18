/** Supplier invoice (MOD-61) — three-way match + GL post. Gated. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./supplier_invoice.controller");
const validator = require("./supplier_invoice.validator");

const MODULE = "MOD-61";
const router = express.Router();
router.use(authMiddleware);
router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.post("/:id/match", requirePermission(MODULE, "edit"), controller.match);
router.post("/:id/post", requirePermission(MODULE, "approve"), validator.post, controller.post);
// Settling AP moves money out of the treasury — an approval-grade action, the
// same gate the posting itself uses.
router.post("/:id/pay", requirePermission(MODULE, "approve"), validator.pay, controller.pay);
// Reversing a posted/paid invoice creates contra ledger entries — as
// consequential as the posting, same gate.
router.post("/:id/reverse", requirePermission(MODULE, "approve"), validator.reverse, controller.reverse);

module.exports = { basePath: "/supplier-invoices", feature: null, router };
