/**
 * Kaizen ops routes (INFRASTRUCTURE_PLAN §3) — mounted by platform.routes.js
 * UNDER platformAuth, so every route here already has req.platformUser and
 * req.platformCaps.
 *
 * CAPABILITY TIERS (migration 0096)
 *   ops.read     — health, backup freshness, run log, drills, uptime, windows
 *   ops.operate  — trigger a backup, sync, integrity scan, drill or probe
 *   ops.maintain — schedule or cancel a maintenance window
 *
 * The split is about blast radius, not seniority. `ops.read` is safe for anyone
 * on call. `ops.operate` spends real I/O on a shared Postgres host and can
 * create a full scratch copy of a tenant database. `ops.maintain` is the only
 * tier that changes what TENANT USERS see — a READ_ONLY window parks their
 * writes — so it is deliberately not implied by being able to run a backup.
 *
 * ROUTE ORDER. Literal segments are declared before their `:param` siblings
 * throughout (`/ops/backups/runs` before `/ops/backups/:slug`, `/ops/health/
 * collect` before `/ops/health/:tenantId`). Express matches in declaration
 * order, and the reverse order binds "runs" as a slug — which fails the slug
 * guard with a 422 that looks like a broken console and is genuinely annoying
 * to trace. Same footgun the errors router documents.
 */
"use strict";

const express = require("express");
const c = require("./ops.controller");
const { validateQuery, validateBody, validateParams } = require("./ops.validator");
const { requireCap } = require("../../../middleware/platform-auth");

const router = express.Router();

/* ── Health ─────────────────────────────────────────────────────────────── */
router.get("/ops/health", requireCap("ops.read"), c.fleetHealth);
router.post("/ops/health/collect", requireCap("ops.operate"), c.collectHealth);
router.get(
  "/ops/health/:tenantId",
  requireCap("ops.read"),
  validateParams("tenantId"),
  validateQuery("healthHistory"),
  c.tenantHealth,
);

/* ── Postgres backup ────────────────────────────────────────────────────── */
router.get("/ops/backups", requireCap("ops.read"), validateQuery("backupStatus"), c.backupStatus);
router.get("/ops/backups/runs", requireCap("ops.read"), validateQuery("backupRuns"), c.backupRuns);
router.get("/ops/backups/preflight", requireCap("ops.read"), c.backupPreflight);
// WS-B1 layer 2. Its own endpoint because the answer it carries — the RPO that
// actually holds right now — is the one number a nightly-dump dashboard cannot
// tell you, and it changes on a 15-minute cadence rather than a daily one.
router.get("/ops/backups/wal", requireCap("ops.read"), c.walStatus);
router.post("/ops/backups", requireCap("ops.operate"), c.backupAll);
router.post("/ops/backups/prune", requireCap("ops.operate"), c.backupPrune);
router.post("/ops/backups/:slug", requireCap("ops.operate"), validateParams("slug"), c.backupOne);

/* ── Object backup + integrity ──────────────────────────────────────────── */
router.get("/ops/objects", requireCap("ops.read"), c.objectStatus);
router.post("/ops/objects/:slug/sync", requireCap("ops.operate"), validateParams("slug"), c.objectSync);
router.post("/ops/objects/:slug/scan", requireCap("ops.operate"), validateParams("slug"), c.objectScan);

/* ── Restore drills ─────────────────────────────────────────────────────── */
router.get("/ops/drills", requireCap("ops.read"), validateQuery("drills"), c.drills);
router.post("/ops/drills", requireCap("ops.operate"), c.drillScheduled);
router.post(
  "/ops/drills/:slug",
  requireCap("ops.operate"),
  validateParams("slug"),
  validateBody("drillRun"),
  c.drillOne,
);

/* ── Uptime ─────────────────────────────────────────────────────────────── */
router.get("/ops/uptime", requireCap("ops.read"), validateQuery("uptime"), c.uptimeAvailability);
router.get("/ops/uptime/incidents", requireCap("ops.read"), validateQuery("uptime"), c.uptimeIncidents);
router.get("/ops/uptime/targets", requireCap("ops.read"), c.uptimeTargets);
router.post("/ops/uptime/probe", requireCap("ops.operate"), c.uptimeProbe);

/* ── Maintenance windows ────────────────────────────────────────────────── */
router.get("/ops/maintenance", requireCap("ops.read"), validateQuery("maintenance"), c.maintenanceList);
router.post(
  "/ops/maintenance",
  requireCap("ops.maintain"),
  validateBody("maintenanceCreate"),
  c.maintenanceCreate,
);
router.delete(
  "/ops/maintenance/:id",
  requireCap("ops.maintain"),
  validateParams("maintenanceId"),
  c.maintenanceCancel,
);

/* ── Entitlement & metering (WS-S3) ─────────────────────────────────────── */
//
// `plans.read` / `plans.write`, not an ops tier. What a plan GRANTS is a
// commercial decision with revenue consequences, and the people who set prices
// are the people who set limits — splitting the two halves of one decision
// across two permissions would mean neither person could make it.
router.get("/ops/usage", requireCap("plans.read"), validateQuery("usage"), c.fleetUsage);
router.get("/ops/usage/metrics", requireCap("plans.read"), c.usageMetrics);
router.post("/ops/usage/measure", requireCap("ops.operate"), c.measureUsage);
router.get("/ops/usage/:tenantId", requireCap("plans.read"), validateParams("tenantId"), c.tenantUsage);

router.get("/ops/entitlements", requireCap("plans.read"), c.listEntitlements);
router.put(
  "/ops/entitlements/:planId",
  requireCap("plans.write"),
  validateParams("planId"),
  validateBody("entitlementSet"),
  c.setEntitlement,
);
router.delete(
  "/ops/entitlements/:planId/:metric",
  requireCap("plans.write"),
  validateParams("planMetric"),
  c.removeEntitlement,
);

/* ── Support telemetry (WS-M2) ──────────────────────────────────────────── */
// support.read, not ops.read: this is the snapshot a triager opens next to a
// ticket, and gating it on ops.read would mean the support role can see the
// ticket but not the context the whole workstream exists to attach to it.
router.get("/ops/telemetry/:slug", requireCap("support.read"), validateParams("slug"), c.telemetry);

// Ticket-keyed, and the one the Support screen actually calls. The slug-keyed
// route above stays: it is the right shape when an operator is looking at a
// tenant rather than at a complaint.
router.get(
  "/ops/support/:ticketId/context",
  requireCap("support.read"),
  validateParams("ticketId"),
  c.supportContext,
);

module.exports = router;
