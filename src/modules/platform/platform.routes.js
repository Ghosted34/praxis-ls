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
const { validate } = require("./platform.validator");
const { platformAuth, requireCap } = require("../../middleware/platform-auth");

const router = express.Router();

// Public — this is how a platform token is obtained in the first place.
router.post("/auth/login", validate("login"), c.login);
router.post("/auth/refresh", validate("refresh"), c.refresh);

router.use(platformAuth);

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
router.get("/settings", c.settingsList);
router.post("/settings/push/vapid/generate", validate("vapidGenerate"), c.vapidGenerate);
router.get("/settings/:section/:key", c.settingGet);
router.put("/settings/:section/:key", validate("platformSetting"), c.settingPut);
router.post("/settings/:section/:key/test", c.settingTest);

module.exports = router;
