"use strict";
const express = require("express");
const { authMiddleware } = require("../../middleware/auth");
const { makeRouter } = require("../../shared/crud/resource");
const controller = require("./notification.controller");
const validator = require("./notification.validator");

// Require authentication for all notification routes. NOTE (follow-up, not this
// pass): the generic list() is not yet self-scoped — it returns every tenant
// notification, not just req.user's. Watch-the-Watcher writes rows targeted at
// CEO/MANAGEMENT (user_id set), so read access should be filtered to
// req.user.user_id before this is exposed to non-admin roles. Tracked in
// doc/WORK_TO_BE_DONE.md.
const router = express.Router();
router.use(authMiddleware);
router.use(makeRouter({ controller, validator }));

module.exports = { basePath: "/notifications", feature: null, router };
