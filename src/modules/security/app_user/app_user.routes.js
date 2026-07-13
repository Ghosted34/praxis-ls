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
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./app_user.controller");
const validator = require("./app_user.validator");

// Generic user CRUD (list/get/create/update/soft-delete) — NOW GATED (was the
// one deliberately-ungated security module, see doc/WORK_TO_BE_DONE.md Phase 0).
// User administration is IAM & user access → MOD-67, same grant the rest of the
// IAM screen group (iam_role/capability/scope/permission/field_visibility) uses.
// Built explicitly (not makeRouter) so each verb carries its own action check,
// mirroring capability.routes.js. Bootstrap still works: the first admin is
// created by scripts/tenant/create-admin.js (direct DB write), not this API.
const MODULE = "MOD-67";
const usersRouter = express.Router();
usersRouter.use(authMiddleware);
usersRouter.get("/", requirePermission(MODULE, "view"), controller.list);
usersRouter.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
usersRouter.get("/:id", requirePermission(MODULE, "view"), controller.get);
usersRouter.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
usersRouter.post("/:id/password", requirePermission(MODULE, "edit"), validator.password, controller.setPassword);
usersRouter.post("/:id/status", requirePermission(MODULE, "edit"), validator.status, controller.setStatus);
// Per-user email signature (2.1)
usersRouter.get("/:id/email-signature", requirePermission(MODULE, "view"), controller.getSignature);
usersRouter.put("/:id/email-signature", requirePermission(MODULE, "edit"), validator.signature, controller.setSignature);

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

// Device-bound quick PIN login. /pin/login is public (it's a way to obtain a
// token); register/list/revoke require a valid access token (the device is
// trusted precisely because the user was fully signed in when registering it).
authRouter.post("/pin/login", validator.pinLogin, controller.pinLogin);
authRouter.post("/pin/register", authMiddleware, validator.pinRegister, controller.pinRegister);
authRouter.get("/pin/devices", authMiddleware, controller.pinDevices);
authRouter.delete("/pin/devices/:deviceId", authMiddleware, controller.pinRevoke);

const router = express.Router();
router.use("/users", usersRouter);
router.use("/auth", authRouter);

module.exports = { basePath: "/", feature: null, router };
