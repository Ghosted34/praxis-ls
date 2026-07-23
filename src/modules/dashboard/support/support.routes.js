/**
 * Tenant-side Support & Feedback (PRD §11.2). The tenant→Praxis channel: raise
 * support/bug/feature tickets and see their lifecycle. Ungated (feature:null) —
 * reaching Praxis for help must never be switched off. Triage lives on the
 * Platform Console (/api/platform/support/*).
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { validate } = require("./support.validator");
const c = require("./support.controller");

const router = express.Router();
router.use(authMiddleware);

router.get("/tickets", c.list);
router.post("/tickets", validate("create"), c.create);
router.get("/tickets/:id", c.get);
router.post("/tickets/:id/csat", validate("csat"), c.csat);

module.exports = { basePath: "/support", feature: null, router };
