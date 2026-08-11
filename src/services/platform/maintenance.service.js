/**
 * WS-M1 — maintenance windows, and WS-M2 — support↔telemetry linking.
 *
 * WS-M1: announced maintenance. A window writes a tenant-facing banner for its
 * duration and clears itself afterwards — no operator has to remember to take
 * it down, which is the failure mode that leaves "scheduled maintenance
 * tonight" on a screen for three weeks and teaches everyone to ignore banners.
 *
 * WS-M2: a support ticket opens with the reporting tenant's live telemetry
 * attached — health, recent errors, backup state — so triage starts with
 * context instead of a round-trip asking for it.
 *
 * WHY THE ACTIVE-WINDOW LOOKUP IS CACHED
 *
 *   `activeFor()` is called on requests that render a banner, which is close to
 *   all of them. A platform-DB query per request to discover that there is no
 *   maintenance — the answer 99.9% of the time — is a cost paid constantly for
 *   a rare event. A short TTL cache makes the common answer free; the window is
 *   scheduled minutes-to-days ahead, so being up to TTL seconds late to display
 *   a banner is immaterial.
 */
"use strict";

const platformDb = require("./db");
const { logger } = require("../../config/logger");

const CACHE_TTL_MS = 30_000;
let cache = { at: 0, rows: [] };

/** All windows that are active or upcoming, cached briefly. */
async function loadWindows(force = false) {
  if (!force && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
  const { rows } = await platformDb.query(
    `SELECT maintenance_window_id, tenant_id, starts_at, ends_at, title, message, mode
       FROM platform.maintenance_window
      WHERE cancelled_at IS NULL AND ends_at > now()
      ORDER BY starts_at`,
  );
  cache = { at: Date.now(), rows };
  return rows;
}

function invalidate() {
  cache = { at: 0, rows: [] };
}

/**
 * The window in force for a tenant right now, or null.
 *
 * A fleet-wide window (`tenant_id IS NULL`) applies to everyone. Where both a
 * fleet window and a tenant-specific one are active, the tenant-specific one
 * wins — it is the more precise statement, and it is the one someone wrote
 * about this tenant deliberately.
 */
async function activeFor(tenantId) {
  const now = Date.now();
  const windows = (await loadWindows()).filter(
    (w) => new Date(w.starts_at) <= now && new Date(w.ends_at) > now,
  );
  if (!windows.length) return null;
  const specific = windows.find((w) => w.tenant_id === tenantId);
  return specific || windows.find((w) => w.tenant_id === null) || null;
}

/** Is this tenant currently parked read-only by a maintenance window? */
async function isReadOnly(tenantId) {
  const w = await activeFor(tenantId);
  return Boolean(w && w.mode === "READ_ONLY");
}

async function schedule({ tenantId = null, startsAt, endsAt, title, message = null, mode = "ANNOUNCE", createdBy = null }) {
  if (!title) throw new Error("a maintenance window needs a title — it is what users will read");
  if (new Date(endsAt) <= new Date(startsAt)) throw new Error("ends_at must be after starts_at");

  const { rows } = await platformDb.query(
    `INSERT INTO platform.maintenance_window
       (tenant_id, starts_at, ends_at, title, message, mode, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [tenantId, startsAt, endsAt, title, message, mode, createdBy],
  );
  invalidate();
  logger.info({ id: rows[0].maintenance_window_id, tenantId, mode }, "maintenance window scheduled");
  return rows[0];
}

/** End a window early. The plan is kept; only its effect stops. */
async function cancel(id) {
  const { rows } = await platformDb.query(
    `UPDATE platform.maintenance_window SET cancelled_at=now()
      WHERE maintenance_window_id=$1 AND cancelled_at IS NULL RETURNING *`,
    [id],
  );
  invalidate();
  return rows[0] || null;
}

async function list({ includePast = false } = {}) {
  const { rows } = await platformDb.query(
    `SELECT * FROM platform.maintenance_window
      ${includePast ? "" : "WHERE ends_at > now() AND cancelled_at IS NULL"}
      ORDER BY starts_at DESC LIMIT 100`,
  );
  return rows;
}

/**
 * WS-M2 — the telemetry snapshot attached to a support ticket.
 *
 * Deliberately a SNAPSHOT taken at ticket time, not a live join rendered when
 * someone opens the ticket. A ticket says "it was broken at 14:05"; showing
 * today's healthy numbers next to that complaint is worse than showing nothing,
 * because it invites the conclusion that the reporter was mistaken.
 *
 * Required lazily: this reaches across several services and a static import
 * would drag the whole ops stack into anything that touches support tickets.
 */
async function telemetrySnapshot(slug) {
  const snapshot = { slug, captured_at: new Date().toISOString() };

  try {
    const health = require("./health-rollup.service");
    const fleet = await health.fleetHealth();
    const t = fleet.tenants.find((x) => x.slug === slug);
    snapshot.health = t
      ? { status: t.status, reasons: t.reasons, captured_at: t.captured_at, liveness_ms: t.liveness_ms }
      : { status: null, note: "no health sample recorded" };
  } catch (err) {
    snapshot.health = { error: err.message };
  }

  try {
    const backup = require("./backup.service");
    const s = await backup.backupStatus();
    const t = s.tenants.find((x) => x.slug === slug);
    snapshot.backup = t
      ? { last_ok_at: t.last_ok_at, stale: t.stale, never_backed_up: t.never_backed_up }
      : { note: "tenant not in backup report" };
  } catch (err) {
    snapshot.backup = { error: err.message };
  }

  try {
    const uptime = require("./uptime.service");
    const av = await uptime.availability({ days: 7 });
    snapshot.uptime_7d = av.filter((a) => a.tenant_id) .map((a) => ({ host: a.host, availability_pct: a.availability_pct }));
  } catch (err) {
    snapshot.uptime_7d = { error: err.message };
  }

  return snapshot;
}

module.exports = {
  activeFor,
  isReadOnly,
  schedule,
  cancel,
  list,
  loadWindows,
  invalidate,
  telemetrySnapshot,
};
