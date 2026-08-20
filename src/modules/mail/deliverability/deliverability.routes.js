"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireFeature } = require("../../../middleware/feature-gate");
const c = require("./deliverability.controller");
const v = require("./deliverability.validator");

const router = express.Router();
router.use(authMiddleware);
router.use(requireFeature("mail.deliverability"));

router.get("/deliverability", requirePermission("MOD-70", "view"), c.list);
router.post("/deliverability/check", requirePermission("MOD-70", "edit"), v.check, c.check);
router.get("/deliverability/:domain/history", requirePermission("MOD-70", "view"), c.history);

module.exports = { basePath: "/mail", feature: null, router, idParam: "text" };
