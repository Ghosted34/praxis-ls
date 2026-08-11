/**
 * Platform (company dashboard) routes — mounted at /api/platform.
 * Praxis-only: platformAuth authenticates, then each route is gated on a
 * capability from the RBAC permission matrix (requireCap). Root Admin bypasses
 * the checks. This is where the dashboard "toggles the controls" wired to the
 * DB provisioning services.
 */
"use strict";

const express = require("express");
const c = require("./platform.controller");
const { validate, validateParams } = require("./platform.validator");
const { platformAuth, requireCap } = require("../../middleware/platform-auth");
// SEC-C3, 2026-08-04. The platform tier is the highest-privilege login in the
// product — it reaches tenant provisioning, the credential store and God Mode —
// and it had no rate limiting at all. It also has no session store, no
// revocation and no 2FA (SEC-M6), so guessing here is the whole attack.
const { loginLimiter, refreshLimiter } = require("../../shared/http/rate-limit");

const router = express.Router();

// Public — this is how a platform token is obtained in the first place.
router.post("/auth/login", loginLimiter, validate("login"), c.login);
router.post("/auth/refresh", refreshLimiter, validate("refresh"), c.refresh);

router.use(platformAuth);

// Error Command Center (doc/PROMPT_ErrorMonitor_Module.md). Its own router
// because the feature owns 18 routes across three capability tiers, and folding
// them into this file would double its length. Mounted after platformAuth, so
// every route inside already has req.platformUser + req.platformCaps.
router.use("/", require("./errors/errors.routes"));

// Kaizen ops (doc/INFRASTRUCTURE_PLAN.md §3) — fleet health, backup freshness
// and the run log, restore drills, uptime, maintenance windows. Its own router
// for the same reason as the Error Command Center: 23 routes across three
// capability tiers, and the jobs that write these tables all shipped before
// anything could read them.
router.use("/", require("./ops/ops.routes"));

router.get("/catalogue/modules", requireCap("catalogue.read"), c.listModules);
router.get("/catalogue/features", requireCap("catalogue.read"), c.listFeatures);
router.get("/catalogue/capabilities", requireCap("roles.read"), c.capsCatalogue);

router.get("/audit", requireCap("audit.read"), c.audit);

// Plans (billing) + per-plan feature matrix
router.get("/plans", requireCap("plans.read"), c.listPlans);
router.post("/plans", requireCap("plans.write"), validate("planCreate"), c.planCreate);
router.get("/plans/:id/features", requireCap("plans.read"), c.planFeatures);
router.put("/plans/:id/features", requireCap("plans.write"), validate("planFeatures"), c.planSetFeatures);
router.patch("/plans/:id", requireCap("plans.write"), validate("planUpdate"), c.planUpdate);
router.delete("/plans/:id", requireCap("plans.write"), validate("planDelete"), c.planDelete);

// RBAC roles + permission matrix
router.get("/roles", requireCap("roles.read"), c.rolesList);
router.post("/roles", requireCap("roles.write"), validate("roleCreate"), c.roleCreate);
router.put("/roles/:id/permissions", requireCap("roles.write"), validate("rolePerms"), c.roleSetPermissions);
router.delete("/roles/:id", requireCap("roles.write"), c.roleDelete);

// Platform users
router.get("/users", requireCap("users.read"), c.usersList);
router.post("/users", requireCap("users.write"), validate("userCreate"), c.userCreate);
router.patch("/users/:id", requireCap("users.write"), validate("userUpdate"), c.userUpdate);
router.post("/users/:id/password", requireCap("users.write"), validate("userPassword"), c.userSetPassword);
router.delete("/users/:id", requireCap("users.write"), c.userDelete);

// Tenants + lifecycle
router.get("/tenants", requireCap("tenants.read"), c.list);
router.post("/tenants", requireCap("tenants.write"), validate("provision"), c.provision);
router.get("/tenants/:slug", requireCap("tenants.read"), c.get);
router.post("/tenants/:slug/admin", requireCap("tenants.write"), validate("admin"), c.createAdmin);
router.post("/tenants/:slug/suspend", requireCap("tenants.write"), c.suspend);
router.post("/tenants/:slug/resume", requireCap("tenants.write"), c.resume);
router.post("/tenants/:slug/go-live", requireCap("tenants.write"), c.goLive);
router.patch("/tenants/:slug/plan", requireCap("tenants.write"), validate("plan"), c.setPlan);
router.patch("/tenants/:slug/capacity", requireCap("tenants.write"), validate("capacity"), c.setCapacity);
router.patch("/tenants/:slug/sandbox", requireCap("tenants.write"), validate("sandbox"), c.setSandbox);
router.post("/tenants/:slug/sandbox/wipe", requireCap("tenants.write"), c.wipeSandbox);
router.post("/tenants/:slug/migrate", requireCap("tenants.write"), c.migrate);

router.get("/tenants/:slug/features", requireCap("tenants.read"), c.features);
router.patch("/tenants/:slug/features/:featureKey", requireCap("features.write"), validate("feature"), c.setFeature);
router.delete("/tenants/:slug/features/:featureKey", requireCap("features.write"), c.clearFeature);

// Support & Feedback triage — aggregate across all tenants (PRD §11.2).
router.get("/support/tickets", requireCap("support.read"), c.supportList);
router.get("/support/tickets/:id", requireCap("support.read"), c.supportGet);
router.patch("/support/tickets/:id", requireCap("support.write"), validate("ticketStatus"), c.supportSetStatus);

// Deploy-wide integrations (S3 / Geoapify / VAPID) — set + live test. Secrets
// are encrypted at rest; reads return presence + last4 only.
//
// GATED 2026-08-04 (audit SEC-H2 / API F-20). These eight routes carried
// platformAuth but no requireCap, so ANY authenticated platform user of ANY
// role passed — including PLATFORM_SUPPORT, whose entire matrix is
// support.read/write + a few reads. That user could rotate the deployment's S3
// credentials and the AI vendor keys every tenant's runtime uses, and read back
// presence + last4 of every secret. The other 35 routes in this file were gated
// correctly; these were missed, which is why two separate audits found it.
//
// `settings.*` are NEW capabilities (migration 0032). No built-in role except
// Root Admin is granted them, and Root bypasses requireCap anyway — so this is
// a real behaviour change for any non-root role that was relying on the gap.
// That is the point of the fix, not a side effect of it.
router.get("/settings", requireCap("settings.read"), c.settingsList);
router.post("/settings/push/vapid/generate", requireCap("settings.write"), validate("vapidGenerate"), c.vapidGenerate);
router.get("/settings/:section/:key", requireCap("settings.read"), c.settingGet);
router.put("/settings/:section/:key", requireCap("settings.write"), validate("platformSetting"), c.settingPut);
// `test` sends the stored credential to the live provider, so it is a write-tier
// action even though it mutates nothing locally.
router.post("/settings/:section/:key/test", requireCap("settings.write"), validateParams("settingTest"), c.settingTest);

// Deploy-wide AI vendor keys — one shared set every tenant's AI runtime uses.
router.get("/ai-vendors", requireCap("settings.read"), c.aiVendorsList);
router.put("/ai-vendors/:vendor", requireCap("settings.write"), validate("aiVendorSet"), c.aiVendorSet);
router.post("/ai-vendors/:vendor/test", requireCap("settings.write"), validateParams("aiVendorTest"), c.aiVendorTest);

module.exports = router;
