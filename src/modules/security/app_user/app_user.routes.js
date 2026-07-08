/**
 * One module, two sub-routers, so the historically documented external URLs
 * don't move: generic CRUD stays at /api/tenant/users/*, auth actions stay
 * at /api/tenant/auth/* (see doc/RBAC_SECURITY_KICKOFF.md's smoke test).
 * basePath must be an explicit "/" — module-loader defaults an omitted
 * basePath to `/${moduleName}` (i.e. "/app_user"), which we don't want.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./app_user.controller");
const validator = require("./app_user.validator");

// Generic CRUD (list/get/create/update/soft-delete) — unchanged, still ungated.
const usersRouter = makeRouter({ controller, validator });

// Auth actions — login/refresh/2fa-verify are public (this is how a token
// is obtained in the first place, and the 2FA challenge token replaces the
// need for a session on the /2fa/verify leg); logout and the 2FA
// enroll/enable/disable lifecycle require a valid access token.
const authRouter = express.Router();
authRouter.post("/login", validator.login, controller.login);
authRouter.post("/refresh", validator.refresh, controller.refresh);
authRouter.post("/logout", authMiddleware, controller.logout);
authRouter.post("/2fa/verify", validator.verifyTotp, controller.verifyTotp);
authRouter.post("/2fa/setup", authMiddleware, controller.setupTotp);
authRouter.post("/2fa/enable", authMiddleware, validator.totpCode, controller.enableTotp);
authRouter.post("/2fa/disable", authMiddleware, validator.totpCode, controller.disableTotp);

const router = express.Router();
router.use("/users", usersRouter);
router.use("/auth", authRouter);

module.exports = { basePath: "/", feature: null, router };
