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
    `SELECT maintenance_window_id, tenant_id, starts_at, ends_at, title, message, mode, notice_hours
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
 * Pick the window that applies to a tenant from a candidate list.
 *
 * A fleet-wide window (`tenant_id IS NULL`) applies to everyone. Where both a
 * fleet window and a tenant-specific one qualify, the tenant-specific one wins —
 * it is the more precise statement, and it is the one someone wrote about this
 * tenant deliberately.
 */
function pickForTenant(windows, tenantId) {
  if (!windows.length) return null;
  const specific = windows.find((w) => w.tenant_id === tenantId);
  return specific || windows.find((w) => w.tenant_id === null) || null;
}

/** When a window's banner should first appear: starts_at minus its notice. */
function visibleFrom(w) {
  const notice = Number(w.notice_hours ?? 24);
  return new Date(w.starts_at).getTime() - notice * 3_600_000;
}

/** The window in force for a tenant RIGHT NOW (between starts_at and ends_at). */
async function activeFor(tenantId) {
  const now = Date.now();
  const windows = (await loadWindows()).filter(
    (w) => new Date(w.starts_at) <= now && new Date(w.ends_at) > now,
  );
  return pickForTenant(windows, tenantId);
}

/**
 * The window a tenant should SEE — active, or upcoming and inside its notice
 * period.
 *
 * Distinct from `activeFor` on purpose, and the distinction is the whole point
 * of WS-M1. `activeFor` answers "are we in maintenance", which is what the
 * write gate needs. This answers "should the user be told about maintenance",
 * which is broader: an announcement that arrives at the same instant as the
 * disruption is not an announcement. Conflating them is what made the banner
 * useless before 0097.
 *
 * Returns the window plus `state` so the client can word it correctly —
 * "starting in 3 hours" reads very differently from "in progress".
 */
async function visibleFor(tenantId) {
  const now = Date.now();
  const windows = (await loadWindows()).filter(
    (w) => visibleFrom(w) <= now && new Date(w.ends_at).getTime() > now,
  );
  const w = pickForTenant(windows, tenantId);
  if (!w) return null;

  const starting = new Date(w.starts_at).getTime();
  return {
    maintenance_window_id: w.maintenance_window_id,
    title: w.title,
    message: w.message,
    mode: w.mode,
    starts_at: w.starts_at,
    ends_at: w.ends_at,
    state: starting <= now ? "ACTIVE" : "UPCOMING",
    // Never negative: an ACTIVE window has already started, and a countdown
    // that has gone past zero renders as nonsense like "starts in -4 minutes".
    starts_in_minutes: Math.max(0, Math.round((starting - now) / 60000)),
    // Whether writes are actually blocked right now. UPCOMING + READ_ONLY is
    // the case worth getting right: the banner must warn without the client
    // disabling anything yet.
    writes_blocked: w.mode === "READ_ONLY" && starting <= now,
  };
}

/**
 * Is this tenant currently parked read-only by a maintenance window?
 *
 * THE WRITE-BLOCK POLICY LIVES HERE, IN ONE FUNCTION, DELIBERATELY.
 *
 *   Today the answer is "everyone in the tenant is blocked" — matching how
 *   SUSPENDED already behaves, and on the reasoning that if writes were safe
 *   for some users they were probably safe for everyone. That policy is
 *   expected to change: the likely next step is letting a specific tenant role
 *   through.
 *
 *   Keeping the decision in this one predicate means that change is an argument
 *   and a condition here, not surgery across every route. The caller
 *   (`applyTenant`) asks a question; it does not encode the answer.
 */
async function isReadOnly(tenantId /* , actor */) {
  const w = await activeFor(tenantId);
  return Boolean(w && w.mode === "READ_ONLY");
}

async function schedule({ tenantId = null, startsAt, endsAt, title, message = null, mode = "ANNOUNCE", noticeHours = 24, createdBy = null }) {
  if (!title) throw new Error("a maintenance window needs a title — it is what users will read");
  if (new Date(endsAt) <= new Date(startsAt)) throw new Error("ends_at must be after starts_at");

  const { rows } = await platformDb.query(
    `INSERT INTO platform.maintenance_window
       (tenant_id, starts_at, ends_at, title, message, mode, notice_hours, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [tenantId, startsAt, endsAt, title, message, mode, noticeHours, createdBy],
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

/**
 * The slug is joined in rather than left to the caller.
 *
 * A window row carries `tenant_id`, but every surface that displays one — the
 * console table, an audit line, an alert — wants the slug, and the tenant list
 * endpoint does not return `tenant_id` to join against. Resolving it here means
 * one query instead of a client-side lookup that cannot actually be performed.
 * NULL slug keeps its meaning: a fleet-wide window belongs to no tenant.
 */
async function list({ includePast = false } = {}) {
  const { rows } = await platformDb.query(
    `SELECT w.*, t.slug
       FROM platform.maintenance_window w
       LEFT JOIN platform.tenant t ON t.tenant_id = w.tenant_id
      ${includePast ? "" : "WHERE w.ends_at > now() AND w.cancelled_at IS NULL"}
      ORDER BY w.starts_at DESC LIMIT 100`,
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
  visibleFor,
  isReadOnly,
  schedule,
  cancel,
  list,
  loadWindows,
  invalidate,
  telemetrySnapshot,
};
