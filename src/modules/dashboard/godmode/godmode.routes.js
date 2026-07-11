/** God Mode CEO purge console (MOD-00B). CEO-only, always audited. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requireCeo } = require("../../../middleware/rbac");
const c = require("./godmode.controller");
const router = express.Router();
router.use(authMiddleware, requireCeo());
router.get("/soft-deletes", c.list);
router.post("/purge", c.purge);
module.exports = { basePath: "/god-mode", feature: null, router };
