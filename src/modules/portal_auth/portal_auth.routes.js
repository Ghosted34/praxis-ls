/**
 * External portal auth + scoped data (PRD §11.1). basePath /portal (distinct from
 * the staff-facing /portals in the portal module).
 *
 *   PUBLIC                POST /portal/auth/login
 *                         POST /portal/auth/forgot   (always 200)
 *                         POST /portal/auth/accept   (invite/reset token)
 *   PORTAL USER (token)   GET  /portal/me
 *                         GET  /portal/client   (CLIENT grant)
 *                         GET  /portal/investor (INVESTOR grant)
 *                         GET  /portal/auditor  (AUDITOR grant)
 *   STAFF (MOD-67)        GET  /portal/users
 *                         POST /portal/users
 *                         POST /portal/users/invite
 *                         POST /portal/users/:id/password
 *                         POST /portal/users/:id/status
 *
 * feature: null so the public login isn't feature-gated by the module loader.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/rbac");
const { portalAuth } = require("./portal_auth.middleware");
const c = require("./portal_auth.controller");
const v = require("./portal_auth.validator");
// SEC-C3, 2026-08-04. The portal is the INTERNET-FACING auth tier — external
// clients, investors and auditors — and it was the least protected: no limiter
// on any of the three public routes, and (SEC-H6) an 8-character password
// policy with no complexity or breach check behind them. The password policy is
// a separate fix; this closes the unlimited-guessing half.
const { loginLimiter, forgotLimiter, resetLimiter } = require("../../shared/http/rate-limit");

const router = express.Router();

// Public. `forgot` always answers 200 (no account enumeration); `accept` consumes
// a one-time token from an invite or reset mail and returns a live portal token.
router.post("/auth/login", loginLimiter, v.login, c.login);
router.post("/auth/forgot", forgotLimiter, v.forgot, c.forgot);
// `accept` is a token-guessing surface, same shape as staff reset-password.
router.post("/auth/accept", resetLimiter, v.accept, c.accept);

// Portal user (external, token-scoped)
router.get("/me", portalAuth(), c.me);
router.get("/client", portalAuth("CLIENT"), c.client);
router.get("/investor", portalAuth("INVESTOR"), c.investor);
router.get("/auditor", portalAuth("AUDITOR"), c.auditor);

// Staff management — invite/manage external users. IAM & user access (MOD-67).
const M = "MOD-67";
router.get("/users", authMiddleware, requirePermission(M, "view"), c.listUsers);
router.post("/users", authMiddleware, requirePermission(M, "create"), v.create, c.createUser);
// Invite = create-or-find + email a set-password link. Takes no password: staff
// must never choose an external party's credentials. Doubles as "resend".
router.post("/users/invite", authMiddleware, requirePermission(M, "create"), v.invite, c.invite);
router.post("/users/:id/password", authMiddleware, requirePermission(M, "edit"), v.password, c.setPassword);
router.post("/users/:id/status", authMiddleware, requirePermission(M, "edit"), v.status, c.setStatus);

module.exports = { basePath: "/portal", feature: null, router };
