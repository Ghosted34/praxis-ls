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
// Abuse guards. Moved to shared/http/rate-limit.js on 2026-08-04 (audit SEC-C3
// + SEC-H5): the limiters that existed here were in-memory (so a two-container
// deploy allowed 2x the configured max) and covered only the recovery
// endpoints, leaving login, refresh, 2FA verify and PIN login unthrottled.
const {
  loginLimiter,
  refreshLimiter,
  totpLimiter,
  pinLimiter,
  forgotLimiter,
  resetLimiter,
  changePasswordLimiter,
} = require("../../../shared/http/rate-limit");

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
// Live-schema employees for the user↔employee link picker (before /:id so
// "employees" isn't captured as an :id). app_user + its FK live in the live
// schema, so the picker must not offer sandbox employees.
usersRouter.get("/employees", requirePermission(MODULE, "view"), controller.linkableEmployees);
usersRouter.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
usersRouter.get("/:id", requirePermission(MODULE, "view"), controller.get);
usersRouter.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
usersRouter.post("/:id/password", requirePermission(MODULE, "edit"), validator.password, controller.setPassword);
usersRouter.post("/:id/status", requirePermission(MODULE, "edit"), validator.status, controller.setStatus);
// Re-send an activation link. `edit`, like setting a password directly — it is
// the same authority, exercised in the safer direction (the administrator never
// learns the credential).
usersRouter.post("/:id/invite", requirePermission(MODULE, "edit"), forgotLimiter, controller.resendInvite);
// Per-user email signature (2.1)
usersRouter.get("/:id/email-signature", requirePermission(MODULE, "view"), controller.getSignature);
usersRouter.put("/:id/email-signature", requirePermission(MODULE, "edit"), validator.signature, controller.setSignature);

// Auth actions — login/refresh/2fa-verify are public (this is how a token
// is obtained in the first place, and the 2FA challenge token replaces the
// need for a session on the /2fa/verify leg); logout and the 2FA
// enroll/enable/disable lifecycle require a valid access token.
const authRouter = express.Router();
// SEC-C3: every one of the four public token-obtaining routes below was
// unthrottled until 2026-08-04. The limiter goes BEFORE the validator so a
// malformed flood is cheap to reject.
authRouter.post("/login", loginLimiter, validator.login, controller.login);
authRouter.post("/refresh", refreshLimiter, validator.refresh, controller.refresh);
// Self-service password recovery (public: this is how a locked-out user gets
// back in). forgot-password always returns { ok: true } (no user enumeration).
authRouter.post("/forgot-password", forgotLimiter, validator.forgotPassword, controller.forgotPassword);
authRouter.post("/reset-password", resetLimiter, validator.resetPassword, controller.resetPassword);
// Signed-in self-service change (current password → new one). Needs NO grant:
// every user must be able to rotate their own credential, and /users/:id/password
// above is behind MOD-67 edit, so before this route the only way for an ordinary
// user to change a password they already knew was to mail themselves a recovery
// link. authMiddleware runs BEFORE the limiter here (the reverse of the public
// routes): it is itself the cheap rejection for an unauthenticated flood, and the
// limiter keys on the identity it establishes — see changePasswordLimiter.
authRouter.post("/change-password", authMiddleware, changePasswordLimiter, validator.changePassword, controller.changePassword);
authRouter.get("/me", authMiddleware, controller.me);
authRouter.post("/logout", authMiddleware, controller.logout);
// Self-service profile picture upload (base64 data URL → /media, sets avatar_ref).
authRouter.post("/avatar", authMiddleware, validator.avatar, controller.setAvatar);
// A 6-digit TOTP is a 10^6 space on a ~30s window — the tightest limiter here.
authRouter.post("/2fa/verify", totpLimiter, validator.verifyTotp, controller.verifyTotp);
authRouter.post("/2fa/setup", authMiddleware, controller.setupTotp);
authRouter.post("/2fa/enable", authMiddleware, validator.totpCode, controller.enableTotp);
authRouter.post("/2fa/disable", authMiddleware, validator.totpCode, controller.disableTotp);

// Device-bound quick PIN login. /pin/login is public (it's a way to obtain a
// token); register/list/revoke require a valid access token (the device is
// trusted precisely because the user was fully signed in when registering it).
authRouter.post("/pin/login", pinLimiter, validator.pinLogin, controller.pinLogin);
authRouter.post("/pin/register", authMiddleware, validator.pinRegister, controller.pinRegister);
authRouter.get("/pin/devices", authMiddleware, controller.pinDevices);
authRouter.delete("/pin/devices/:deviceId", authMiddleware, controller.pinRevoke);

const router = express.Router();
router.use("/users", usersRouter);
router.use("/auth", authRouter);

module.exports = { basePath: "/", feature: null, router };
