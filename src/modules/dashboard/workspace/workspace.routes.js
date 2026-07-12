/** My Workspace (MOD-00A). Any authenticated user sees their own. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const c = require("./workspace.controller");
const router = express.Router();
router.use(authMiddleware);
router.get("/", c.mine);
module.exports = { basePath: "/workspace", feature: null, router };
