"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const controller = require("./auth.controller");
const validator = require("./auth.validator");

const router = express.Router();

// Public — this is how a token is obtained in the first place.
router.post("/login", validator.login, controller.login);
router.post("/refresh", validator.refresh, controller.refresh);

// Requires a valid access token (to know which session/user to kill).
router.post("/logout", authMiddleware, controller.logout);

module.exports = { basePath: "/auth", feature: null, router };
