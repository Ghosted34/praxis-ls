"use strict";
/**
 * Platform-side Support & Feedback triage (PRD §11.2). Reads/curates
 * platform.support_ticket across ALL tenants (joined to platform.tenant for
 * human names) and drives the NEW→TRIAGED→IN_PROGRESS→SHIPPED/DECLINED
 * lifecycle. Every status change lands in platform.platform_audit.
 */
const platformDb = require("./db");
const entitlement = require("./entitlement.service");
const { logger } = require("../../config/logger");

const STATUSES = ["NEW", "TRIAGED", "IN_PROGRESS", "SHIPPED", "DECLINED"];

async function audit(actorId, tenantId, action, entityRef, payload) {
  await platformDb.query(
    "INSERT INTO platform.platform_audit (actor_id, tenant_id, action, entity_ref, payload) VALUES ($1,$2,$3,$4,$5)",
    [actorId, tenantId, action, entityRef, payload || {}],
  );
}

const SELECT =
  "SELECT st.*, t.slug AS tenant_slug, t.display_name AS tenant_name " +
  "FROM platform.support_ticket st JOIN platform.tenant t ON t.tenant_id = st.tenant_id ";

async function list({ status, kind, tenant, limit } = {}) {
  const params = [];
  const where = [];
  if (status) { params.push(status); where.push(`st.status = $${params.length}`); }
  if (kind) { params.push(kind); where.push(`st.kind = $${params.length}`); }
  if (tenant) { params.push(tenant); where.push(`t.slug = $${params.length}`); }
  const lim = Math.min(Math.max(parseInt(limit, 10) || 300, 1), 1000);
  const sql = SELECT + (where.length ? "WHERE " + where.join(" AND ") + " " : "") +
    "ORDER BY st.created_at DESC LIMIT " + lim;
  const { rows } = await platformDb.query(sql, params);
  return rows;
}

async function get(id) {
  const { rows } = await platformDb.query(SELECT + "WHERE st.ticket_id = $1", [id]);
  if (!rows[0]) { const e = new Error("ticket not found"); e.status = 404; throw e; }
  return rows[0];
}

async function setStatus(id, status, actorId) {
  if (!STATUSES.includes(status)) { const e = new Error("invalid status"); e.status = 422; throw e; }
  const { rows } = await platformDb.query(
    "UPDATE platform.support_ticket SET status = $2 WHERE ticket_id = $1 RETURNING *",
    [id, status],
  );
  if (!rows[0]) { const e = new Error("ticket not found"); e.status = 404; throw e; }
  await audit(actorId, rows[0].tenant_id, "support.status_changed", id, { status });
  return rows[0];
}

/* ── WS-M2 — support ↔ telemetry linking ─────────────────────────────────── */

/**
 * Everything already known about the reporting tenant, gathered for one ticket.
 *
 * ── WHY THIS IS A READ AND NOT A FEATURE ───────────────────────────────────
 *
 *   None of this is new data. Health, errors, backup state and usage are all
 *   already collected, all already keyed by `tenant_id`, and `support_ticket`
 *   has carried `tenant_id` since it was created. The only reason triage began
 *   from nothing was that nobody had put them on the same screen. So this is a
 *   join, and it is worth being explicit that the twenty minutes it saves per
 *   ticket were being spent re-deriving facts the platform already knew.
 *
 * ── WHY IT IS CAPTURED AT READ TIME, NOT SNAPSHOTTED ONTO THE TICKET ───────
 *
 *   The tempting alternative is to copy these figures onto the ticket row when
 *   it is filed. That answers "what did it look like when they complained",
 *   which sounds like the more useful question and is not: by the time anyone
 *   opens the ticket, what they need to know is whether it is STILL happening.
 *   The history window below covers the first question well enough, and reading
 *   live means a ticket opened during an incident and re-read after it clears
 *   shows the recovery rather than freezing the panic.
 *
 * ── WHY ONE FAILURE CANNOT LOSE THE OTHERS ─────────────────────────────────
 *
 *   Each block is independently guarded. A tenant with no health samples yet, a
 *   backup registry that has never run, or a plan with no entitlements are all
 *   NORMAL states, not errors — and a triage screen that renders nothing because
 *   one of five panels has no rows is worse than one that renders four.
 */
async function context(ticketId, { historyHours = 48 } = {}) {
  const ticket = await get(ticketId);
  const tenantId = ticket.tenant_id;

  const safe = async (label, fn, fallback = null) => {
    try {
      return await fn();
    } catch (err) {
      // Debug, not warn: "this tenant has no backups yet" is an ordinary answer
      // and logging it at warning level on every ticket open would be noise.
      logger.debug({ err, label, ticketId }, "support context block unavailable");
      return fallback;
    }
  };

  const [snapshot, current, history, backups, drill, usage, maintenance] = await Promise.all([
    // COMPOSED, NOT REIMPLEMENTED.
    //
    // `maintenance.telemetrySnapshot(slug)` already assembles health, backup
    // freshness and 7-day uptime, and it is already exposed at
    // GET /ops/telemetry/:slug — it was simply never called from the ticket
    // screen, which is why triage still started from nothing. Rebuilding those
    // three here would create a second answer to the same question that drifts
    // from the first. This adds what it does not cover and reuses what it does.
    //
    // Required lazily for the reason its own docstring gives: a static import
    // drags the whole ops stack into anything touching support tickets.
    safe("snapshot", () =>
      require("./maintenance.service").telemetrySnapshot(ticket.tenant_slug),
    ),

    // The extra health columns the snapshot does not carry — the ones that say
    // WHY, and (since WS-S1) how close to capacity the tenant is running.
    safe("health_detail", async () => {
      const { rows } = await platformDb.query(
        `SELECT error_count_24h, last_error_at, schema_behind,
                pool_utilisation_pct, pool_max, pool_total
           FROM platform.tenant_health
          WHERE tenant_id = $1
          ORDER BY captured_at DESC
          LIMIT 1`,
        [tenantId],
      );
      return rows[0] || null;
    }),

    // The window that catches an intermittent fault which has since cleared —
    // the single most common way a ticket and a dashboard disagree. Aggregated
    // rather than returned raw: a sweep every few minutes over 48 hours is
    // hundreds of rows, and triage wants "was it ever red", not a time series.
    safe("history", async () => {
      const { rows } = await platformDb.query(
        `SELECT status, count(*)::int AS samples,
                min(captured_at) AS first_seen, max(captured_at) AS last_seen
           FROM platform.tenant_health
          WHERE tenant_id = $1
            AND captured_at > now() - ($2 || ' hours')::interval
          GROUP BY status`,
        [tenantId, String(historyHours)],
      );
      const by = Object.fromEntries(rows.map((r) => [r.status, r]));
      return {
        window_hours: historyHours,
        green: by.GREEN ? by.GREEN.samples : 0,
        amber: by.AMBER ? by.AMBER.samples : 0,
        red: by.RED ? by.RED.samples : 0,
        // The flag that matters most on a triage screen: a tenant that is fine
        // NOW but was not, during the window the ticket describes.
        degraded_in_window: Boolean(by.AMBER || by.RED),
        worst_seen: by.RED ? "RED" : by.AMBER ? "AMBER" : by.GREEN ? "GREEN" : null,
        last_red_at: by.RED ? by.RED.last_seen : null,
      };
    }),

    // Last good backup and whether anything has failed since. Both, because
    // "the last run succeeded" and "nothing has failed" are different claims and
    // a data-loss ticket needs the second one.
    safe("backups", async () => {
      const { rows } = await platformDb.query(
        `SELECT
           max(finished_at) FILTER (WHERE status = 'OK'   AND kind = 'PG_DUMP') AS last_ok_dump,
           max(finished_at) FILTER (WHERE status = 'OK'   AND kind = 'OBJECT_SYNC') AS last_ok_objects,
           count(*)         FILTER (WHERE status = 'FAILED' AND started_at > now() - interval '7 days') AS failures_7d
         FROM platform.backup_run
        WHERE tenant_id = $1`,
        [tenantId],
      );
      const r = rows[0] || {};
      const lastOk = r.last_ok_dump ? new Date(r.last_ok_dump) : null;
      const ageHours = lastOk ? Math.round((Date.now() - lastOk.getTime()) / 36e5) : null;
      return {
        last_ok_dump: r.last_ok_dump || null,
        last_ok_objects: r.last_ok_objects || null,
        failures_7d: Number(r.failures_7d || 0),
        age_hours: ageHours,
        // D4 ratified RPO ≤ 24h from nightly dumps, so staleness is measured
        // against the target that was actually signed off rather than a number
        // invented here.
        stale: ageHours === null || ageHours > 24,
      };
    }),

    // Whether this tenant's backups have ever been PROVEN restorable. On a
    // data-loss ticket this is the first question worth answering and the one
    // least likely to be asked in the moment.
    safe("drill", async () => {
      const { rows } = await platformDb.query(
        `SELECT ok, rto_seconds, ran_at, restored_to
           FROM platform.restore_drill
          WHERE tenant_id = $1
          ORDER BY ran_at DESC
          LIMIT 1`,
        [tenantId],
      );
      return rows[0] || null;
    }),

    // Usage against plan — turns "it stopped letting me add someone" from an
    // investigation into a glance, which since WS-S3 started actually blocking
    // things is a ticket category that now exists.
    safe("usage", () => entitlement.statusFor(tenantId), []),

    // An announced maintenance window overlapping the report explains a whole
    // class of ticket outright.
    safe("maintenance", async () => {
      const { rows } = await platformDb.query(
        `SELECT title, starts_at, ends_at
           FROM platform.maintenance_window
          WHERE (tenant_id = $1 OR tenant_id IS NULL)
            AND ends_at   > $2::timestamptz - interval '2 hours'
            AND starts_at < now() + interval '2 hours'
          ORDER BY starts_at DESC
          LIMIT 5`,
        [tenantId, ticket.created_at],
      );
      return rows;
    }, []),
  ]);

  // The snapshot's health block is the authoritative status/reasons; the extra
  // columns read above are merged onto it rather than shadowing it.
  const health = { ...((snapshot && snapshot.health) || {}), ...(current || {}) };

  return {
    ticket,
    health,
    uptime_7d: (snapshot && snapshot.uptime_7d) || null,
    history,
    // Prefer the richer local read; fall back to the snapshot's simpler one if
    // the backup registry query failed but the snapshot's did not.
    backups: backups || (snapshot && snapshot.backup) || null,
    last_drill: drill,
    usage,
    maintenance,
    // A one-line verdict so the screen leads with an answer rather than six
    // panels the reader has to correlate themselves.
    summary: summarise({ current: health, history, backups, usage, maintenance }),
  };
}

/**
 * The headline.
 *
 * Ordered by what most often explains a ticket, and it returns the FIRST match
 * rather than a list: a triage summary that says four things says nothing. The
 * panels underneath carry the rest.
 */
function summarise({ current, history, backups, usage, maintenance }) {
  if (maintenance && maintenance.length) {
    return `Maintenance window "${maintenance[0].title}" overlaps this report.`;
  }
  if (current && current.status === "RED") {
    return `Tenant is RED now: ${(current.reasons || []).join("; ") || "no reason recorded"}.`;
  }
  const over = (usage || []).filter((u) => u.over);
  if (over.length) {
    return `Over plan limit: ${over.map((u) => `${u.label} (${u.used}/${u.limit})`).join(", ")}.`;
  }
  if (history && history.degraded_in_window && (!current || current.status === "GREEN")) {
    return `Healthy now, but was ${history.worst_seen} in the last ${history.window_hours}h — likely intermittent.`;
  }
  if (current && current.status === "AMBER") {
    return `Tenant is AMBER: ${(current.reasons || []).join("; ") || "no reason recorded"}.`;
  }
  if (backups && backups.stale) {
    return "Tenant health is fine, but its last good backup is stale — check before any data action.";
  }
  if (!current) return "No health samples recorded for this tenant yet.";
  return "Tenant healthy, within plan, backups current — no platform-side explanation.";
}

module.exports = { list, get, setStatus, context, summarise, STATUSES };
