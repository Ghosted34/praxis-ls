/**
 * Kaizen ops HTTP controller (INFRASTRUCTURE_PLAN §3) — thin: delegate to the
 * services in src/services/platform/*.
 *
 * WHY THESE ROUTES EXIST AT ALL
 *
 *   The collectors, backup jobs, drills, probes and maintenance service all
 *   landed before any of this was readable. Every one of them writes to a
 *   platform table that no operator could open — which means the fleet was
 *   observable to the database and to nobody else. §3's stated goal is that 50
 *   tenants be as observable and recoverable as 5, and an operator who has to
 *   run psql to answer "when was this tenant last backed up" does not have that.
 *
 * READS ARE CHEAP, ACTIONS ARE NOT
 *
 *   The GETs read tables the jobs already populate, so they are safe to poll.
 *   The POSTs re-run real work — a pg_dump, an object sync, a restore drill that
 *   creates a full scratch copy of a tenant database. They are gated on a
 *   separate capability (ops.operate) for that reason, and the expensive ones
 *   run detached: an HTTP request is the wrong thing to hold open for the length
 *   of a fleet backup, and a proxy timing out mid-dump would leave the operator
 *   with no idea whether it was still running. Those endpoints acknowledge with
 *   202 and the result lands in backup_run / restore_drill, which is what the
 *   console is reading anyway.
 */
"use strict";

const health = require("../../../services/platform/health-rollup.service");
const backup = require("../../../services/platform/backup.service");
const restore = require("../../../services/platform/restore.service");
const objects = require("../../../services/platform/object-backup.service");
const uptime = require("../../../services/platform/uptime.service");
const maintenance = require("../../../services/platform/maintenance.service");
const support = require("../../../services/platform/support.service");
const entitlement = require("../../../services/platform/entitlement.service");
const store = require("../../../services/platform/backup-storage.service");
const registry = require("../../../services/tenant/registry.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

const actor = (req) => (req.platformUser ? req.platformUser.platform_user_id : null);

/** Resolve a tenant or 404 — every :slug action needs the registry row. */
async function tenantOr404(slug) {
  const meta = await registry.resolveBySlug(slug);
  if (!meta) throw new AppError("NOT_FOUND", `No tenant "${slug}"`, 404);
  return meta;
}

/**
 * Run a long job without holding the request open.
 *
 * The rejection handler is not optional: an unhandled rejection from a detached
 * promise takes the process down on modern Node, and "the API restarted because
 * someone clicked Back up now" is a spectacular way to fail. The failure is
 * already recorded as a FAILED row by the service itself; this only stops it
 * from also being fatal.
 */
function detach(label, promise, req) {
  promise.catch((err) =>
    logger.error({ err, label, actor: actor(req) }, `detached ops action failed: ${label}`),
  );
}

/* ── Health (WS-H1 / WS-H2) ─────────────────────────────────────────────── */

const fleetHealth = asyncHandler(async (_req, res) =>
  res.json({ data: await health.fleetHealth() }),
);

const tenantHealth = asyncHandler(async (req, res) =>
  res.json({
    data: await health.tenantHistory(req.params.tenantId, {
      hours: req.query.hours || 24,
    }),
  }),
);

// Synchronous on purpose: a fleet health sweep is seconds, and an operator who
// clicks "Collect now" wants the refreshed grid in the same interaction.
const collectHealth = asyncHandler(async (_req, res) =>
  res.json({ data: await health.collectFleetHealth() }),
);

/* ── Postgres backup (WS-B1) ────────────────────────────────────────────── */

const backupStatus = asyncHandler(async (req, res) =>
  res.json({
    data: await backup.backupStatus({
      rpoHours: req.query.rpo_hours || 24,
      graceHours: req.query.grace_hours ?? 6,
    }),
  }),
);

const backupRuns = asyncHandler(async (req, res) =>
  res.json({
    data: await backup.recentRuns({
      limit: req.query.limit || 100,
      kind: req.query.kind || null,
      status: req.query.status || null,
      slug: req.query.slug || null,
    }),
  }),
);

// Cheap and diagnostic — it shells out to `pg_dump --version` and compares
// against the server. Kept synchronous because its entire value is telling an
// operator, right now, why the nightly job is failing for every tenant.
const backupPreflight = asyncHandler(async (_req, res) =>
  res.json({ data: await backup.preflight() }),
);

// WS-B1 layer 2 — the achievable RPO right now, which is not the same as the
// one in the plan. A dead archiver silently downgrades it from minutes to a
// full day, and the nightly-dump view cannot show that.
const walStatus = asyncHandler(async (_req, res) =>
  res.json({ data: await backup.walStatus() }),
);

const backupOne = asyncHandler(async (req, res) => {
  const meta = await tenantOr404(req.params.slug);
  detach(`backup ${meta.slug}`, backup.backupTenant(meta), req);
  res.status(202).json({ data: { accepted: true, slug: meta.slug, kind: "PG_DUMP" } });
});

const backupAll = asyncHandler(async (req, res) => {
  detach("fleet backup", backup.backupFleet(), req);
  res.status(202).json({ data: { accepted: true, kind: "PG_DUMP", scope: "fleet" } });
});

const backupPrune = asyncHandler(async (_req, res) =>
  res.json({ data: await store.pruneRetention() }),
);

/* ── Object backup + integrity (WS-B2 / WS-B4) ──────────────────────────── */

const objectStatus = asyncHandler(async (_req, res) =>
  res.json({ data: await objects.objectBackupStatus() }),
);

const objectSync = asyncHandler(async (req, res) => {
  const meta = await tenantOr404(req.params.slug);
  detach(`object sync ${meta.slug}`, objects.syncTenantObjects(meta), req);
  res.status(202).json({ data: { accepted: true, slug: meta.slug, kind: "OBJECT_SYNC" } });
});

const objectScan = asyncHandler(async (req, res) => {
  const meta = await tenantOr404(req.params.slug);
  detach(`integrity scan ${meta.slug}`, objects.scanTenantIntegrity(meta), req);
  res.status(202).json({ data: { accepted: true, slug: meta.slug, kind: "SNAPSHOT_SCAN" } });
});

/* ── Restore drills (WS-B3) ─────────────────────────────────────────────── */

const drills = asyncHandler(async (req, res) =>
  res.json({ data: await restore.recentDrills({ limit: req.query.limit || 50 }) }),
);

// Always detached. A drill restores an entire tenant database into a scratch
// copy and runs integrity probes over it; on a real tenant that is minutes at
// best, and the measured RTO is the point of the exercise — a request timeout
// would discard exactly the number being measured.
const drillOne = asyncHandler(async (req, res) => {
  const meta = await tenantOr404(req.params.slug);
  detach(
    `restore drill ${meta.slug}`,
    restore.restoreTenant({ slug: meta.slug, at: req.body.at || null }),
    req,
  );
  res.status(202).json({ data: { accepted: true, slug: meta.slug } });
});

const drillScheduled = asyncHandler(async (req, res) => {
  detach("scheduled restore drill", restore.runScheduledDrill(), req);
  res.status(202).json({ data: { accepted: true, scope: "least-recently-drilled" } });
});

/* ── Uptime (WS-U1) ─────────────────────────────────────────────────────── */

const uptimeAvailability = asyncHandler(async (req, res) =>
  res.json({ data: await uptime.availability({ days: req.query.days || 30 }) }),
);

const uptimeIncidents = asyncHandler(async (req, res) =>
  res.json({ data: await uptime.incidents({ days: req.query.days || 30 }) }),
);

const uptimeTargets = asyncHandler(async (_req, res) =>
  res.json({ data: await uptime.probeTargets() }),
);

const uptimeProbe = asyncHandler(async (_req, res) =>
  res.json({ data: await uptime.probeAll() }),
);

/* ── Maintenance windows (WS-M1) ────────────────────────────────────────── */

const maintenanceList = asyncHandler(async (req, res) =>
  res.json({ data: await maintenance.list({ includePast: req.query.include_past === true }) }),
);

const maintenanceCreate = asyncHandler(async (req, res) => {
  // A window scoped to a tenant that does not exist would be scheduled, stored
  // and never shown to anybody — so an unknown slug is a 404 here, not a
  // silently fleet-wide window, which is the far more dangerous misreading.
  const tenantId = req.body.tenant_slug
    ? (await tenantOr404(req.body.tenant_slug)).tenant_id
    : null;

  res.status(201).json({
    data: await maintenance.schedule({
      tenantId,
      startsAt: req.body.starts_at,
      endsAt: req.body.ends_at,
      title: req.body.title,
      message: req.body.message || null,
      mode: req.body.mode,
      noticeHours: req.body.notice_hours,
      createdBy: actor(req),
    }),
  });
});

const maintenanceCancel = asyncHandler(async (req, res) => {
  const row = await maintenance.cancel(req.params.id);
  if (!row) throw new AppError("NOT_FOUND", "No active maintenance window with that id", 404);
  res.json({ data: row });
});

/* ── Entitlement & metering (WS-S3) ─────────────────────────────────────── */

const fleetUsage = asyncHandler(async (req, res) =>
  res.json({ data: await entitlement.fleetUsage({ period: req.query.period || undefined }) }),
);

const tenantUsage = asyncHandler(async (req, res) =>
  res.json({ data: await entitlement.statusFor(req.params.tenantId) }),
);

// The metric catalogue, so the console can render the picker from one source
// rather than repeating the list — and so `metered: false` is visible rather
// than a metric that silently always reads zero.
const usageMetrics = asyncHandler(async (_req, res) =>
  res.json({
    data: Object.entries(entitlement.METRICS).map(([metric, spec]) => ({ metric, ...spec })),
  }),
);

// Detached: metering opens a connection to every tenant database in turn.
const measureUsage = asyncHandler(async (req, res) => {
  detach("usage metering sweep", entitlement.measureFleet(), req);
  res.status(202).json({ data: { accepted: true, scope: "fleet" } });
});

const listEntitlements = asyncHandler(async (req, res) =>
  res.json({ data: await entitlement.listEntitlements(req.query.plan_id || null) }),
);

const setEntitlement = asyncHandler(async (req, res) =>
  res.json({
    data: await entitlement.setEntitlement({
      planId: req.params.planId,
      metric: req.body.metric,
      limitValue: req.body.limit_value,
      hard: req.body.hard,
    }),
  }),
);

const removeEntitlement = asyncHandler(async (req, res) => {
  const gone = await entitlement.removeEntitlement(req.params.planId, req.params.metric);
  if (!gone) throw new AppError("NOT_FOUND", "No such entitlement on that plan", 404);
  // Removing an entitlement makes the metric UNLIMITED again, not zero. Said in
  // the response because the opposite reading — "I removed it, so now it's
  // capped at nothing" — would be a frightening thing to get wrong.
  res.json({ data: { removed: true, metric: req.params.metric, now: "unlimited" } });
});

/* ── Support telemetry (WS-M2) ──────────────────────────────────────────── */

const telemetry = asyncHandler(async (req, res) =>
  res.json({ data: await maintenance.telemetrySnapshot(req.params.slug) }),
);

/**
 * The same idea keyed by TICKET rather than by slug.
 *
 * `/ops/telemetry/:slug` needs the triager to already know which tenant filed
 * the ticket and to go and look it up — which is most of the twenty minutes
 * WS-M2 exists to remove. This resolves the tenant from the ticket, adds the
 * things a slug-keyed snapshot cannot know (whether the tenant was degraded
 * around the time it was FILED, whether they are against a plan limit, whether
 * a maintenance window overlaps it) and leads with a one-line verdict.
 */
const supportContext = asyncHandler(async (req, res) =>
  res.json({
    data: await support.context(req.params.ticketId, {
      historyHours: Number(req.query.hours) || 48,
    }),
  }),
);

module.exports = {
  fleetHealth,
  tenantHealth,
  collectHealth,
  backupStatus,
  backupRuns,
  backupPreflight,
  walStatus,
  backupOne,
  backupAll,
  backupPrune,
  objectStatus,
  objectSync,
  objectScan,
  drills,
  drillOne,
  drillScheduled,
  uptimeAvailability,
  uptimeIncidents,
  uptimeTargets,
  uptimeProbe,
  maintenanceList,
  maintenanceCreate,
  maintenanceCancel,
  fleetUsage,
  tenantUsage,
  usageMetrics,
  measureUsage,
  listEntitlements,
  setEntitlement,
  removeEntitlement,
  telemetry,
  supportContext,
};
