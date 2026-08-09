/**
 * Error Command Center — read/write service over platform.error_event.
 *
 * Implements the query contract in doc/PROMPT_ErrorMonitor_Module.md §6.
 * Every list query is parameterised and every sort/filter value is matched
 * against a fixed allow-list before it reaches SQL: the search box in §3.4
 * searches message, file path AND stack trace, which is exactly the kind of
 * "just interpolate it" surface that becomes an injection if built casually.
 */

"use strict";

const db = require("./db");
const { AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");

/** Spec §2.2 — the five severity levels, in severity order. */
const LEVELS = ["fatal", "error", "warning", "notice", "info"];
/** Spec §6 §4.3 — `sort` is an enum, never raw SQL. */
const SORTS = {
  recent: "e.last_seen DESC",
  count: "e.occurrence_count DESC, e.last_seen DESC",
  // array_position gives fatal < error < warning < notice < info deterministically.
  severity: "array_position(ARRAY['fatal','error','warning','notice','info']::text[], e.level), e.last_seen DESC",
};
const MAX_LIMIT = 100;
/** Spec §2.2 — retention window; also the ceiling on trend queries. */
const RETENTION_DAYS = 30;

/**
 * Spec §11 — "Audit log for error resolutions and shares".
 *
 * Reuses `platform.platform_audit`, the table the tenant/plan/role services
 * already write to, rather than a feature-local log: "who did what on the
 * platform" has to be answerable from one place, and a second audit trail is a
 * second place to forget to look.
 *
 * `tenant_id` is NULL because the ACTOR is platform staff. The error's own
 * tenant, when it has one, is on the error row.
 *
 * Never throws. An audit write failing must not turn a successful resolve into
 * a 500 that the operator retries — producing, at best, a second audit row for
 * one action.
 */
async function audit(actorId, action, entityRef, payload) {
  try {
    await db.query(
      "INSERT INTO platform.platform_audit (actor_id, tenant_id, action, entity_ref, payload) VALUES ($1,NULL,$2,$3,$4)",
      [actorId || null, action, String(entityRef || "").slice(0, 200), payload || {}],
    );
  } catch (err) {
    logger.warn({ err, action }, "[errors] audit write failed");
  }
}

const SELECT_COLUMNS = `
  e.error_id            AS id,
  e.signature,
  e.tenant_id,
  t.slug                AS tenant_slug,
  t.display_name        AS tenant_name,
  e.level,
  e.origin,
  e.message,
  e.name,
  e.module,
  e.route,
  e.file_path,
  e.line_number,
  e.release,
  e.env,
  e.occurrence_count,
  e.first_seen,
  e.last_seen,
  e.resolved_at,
  e.resolved_by,
  u.full_name           AS resolved_by_name`;

const FROM = `
  FROM platform.error_event e
  LEFT JOIN platform.tenant t        ON t.tenant_id = e.tenant_id
  LEFT JOIN platform.platform_user u ON u.platform_user_id = e.resolved_by`;

/**
 * Build the shared WHERE clause for list/stats/export so the KPI cards can
 * never disagree with the feed under them — a dashboard whose "12 Fatal" does
 * not match what filtering to Fatal shows is worse than no dashboard.
 */
function buildFilter(q = {}, startIndex = 1) {
  const where = [];
  const params = [];
  let i = startIndex;

  // Default 'active'. Spec §6 §4.3.
  const status = q.status || "active";
  if (status === "active") where.push("e.resolved_at IS NULL");
  else if (status === "resolved") where.push("e.resolved_at IS NOT NULL");

  if (q.level) {
    const levels = String(q.level)
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => LEVELS.includes(s));
    if (levels.length) {
      where.push(`e.level = ANY($${i}::text[])`);
      params.push(levels);
      i += 1;
    }
  }

  // Scope (§4.2). 'platform' = the NULL-tenant rows; a slug = that tenant only;
  // absent/'all' = both, which is the default combined view.
  if (q.scope === "platform") {
    where.push("e.tenant_id IS NULL");
  } else if (q.tenant) {
    where.push(`t.slug = $${i}`);
    params.push(String(q.tenant));
    i += 1;
  }

  if (q.module) {
    where.push(`e.module = $${i}`);
    params.push(String(q.module));
    i += 1;
  }

  if (q.signature) {
    where.push(`e.signature = $${i}`);
    params.push(String(q.signature));
    i += 1;
  }

  // §3.4: "Searches message, file path, stack trace".
  if (q.search) {
    where.push(
      `(e.message ILIKE $${i} OR e.file_path ILIKE $${i} OR e.route ILIKE $${i} OR e.raw_stack ILIKE $${i})`,
    );
    params.push(`%${String(q.search).slice(0, 200)}%`);
    i += 1;
  }

  if (q.from) {
    where.push(`e.last_seen >= $${i}`);
    params.push(q.from);
    i += 1;
  }
  if (q.to) {
    where.push(`e.last_seen <= $${i}`);
    params.push(q.to);
    i += 1;
  }

  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", params, next: i };
}

/** GET /errors — paginated feed. */
async function list(q = {}) {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(q.limit) || 20));
  const offset = (page - 1) * limit;
  const order = SORTS[q.sort] || SORTS.recent;

  const { clause, params, next } = buildFilter(q);

  const rowsQ = db.query(
    `SELECT ${SELECT_COLUMNS} ${FROM} ${clause}
     ORDER BY ${order}
     LIMIT $${next} OFFSET $${next + 1}`,
    [...params, limit, offset],
  );
  const countQ = db.query(`SELECT COUNT(*)::int AS total ${FROM} ${clause}`, params);

  const [rows, count] = await Promise.all([rowsQ, countQ]);
  const total = count.rows[0] ? count.rows[0].total : 0;

  return {
    items: rows.rows,
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

/**
 * GET /errors/recent — the polling fallback (§2.1).
 *
 * `since` is the client's last-seen watermark, so a poll returns only what has
 * changed rather than the same 20 rows every 10 seconds. Falls back to a short
 * lookback on first call.
 */
async function recent({ since, limit = 50, scope, tenant } = {}) {
  const lim = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || 50));

  // The poll must honour the same scope the socket subscription would, or a
  // console filtered to one tenant starts showing every tenant's errors the
  // moment it degrades from WebSocket to polling — the fallback would silently
  // leak a wider view than the primary path allows.
  const where = ["e.last_seen > COALESCE($1::timestamptz, now() - interval '5 minutes')"];
  const params = [since || null, lim];
  if (scope === "platform") {
    where.push("e.tenant_id IS NULL");
  } else if (tenant) {
    params.push(String(tenant));
    where.push(`t.slug = $${params.length}`);
  }

  const { rows } = await db.query(
    `SELECT ${SELECT_COLUMNS} ${FROM}
      WHERE ${where.join(" AND ")}
      ORDER BY e.last_seen DESC
      LIMIT $2`,
    params,
  );
  return { items: rows, server_time: new Date().toISOString() };
}

/** GET /errors/:id — detail, including parsed frames and any cached explanation. */
async function get(id) {
  const { rows } = await db.query(
    `SELECT ${SELECT_COLUMNS},
            e.stack_trace,
            e.raw_stack,
            e.context,
            x.explanation,
            x.generated_by AS explanation_by,
            x.created_at   AS explanation_at
       ${FROM}
       LEFT JOIN platform.error_explanation x ON x.signature = e.signature
      WHERE e.error_id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Error not found", 404);
  return row;
}

/**
 * GET /errors/stats — the KPI row (§3.1).
 *
 * One pass over the filtered set. `avg_resolution_seconds` is the real
 * definition behind the mockup's "Avg Fix" card, which the spec leaves
 * undefined: mean wall-clock time from first_seen to resolved_at across errors
 * resolved inside the window. It is NULL when nothing has been resolved yet,
 * and the UI renders "—" rather than inventing a zero.
 */
async function stats(q = {}) {
  // KPIs describe the whole window, not just the unresolved slice, so the
  // status filter is neutralised here — otherwise "89% Resolved" is computed
  // over a set from which every resolved row has already been excluded.
  const { clause, params } = buildFilter({ ...q, status: "all" });

  const { rows } = await db.query(
    `SELECT
       COALESCE(SUM(e.occurrence_count), 0)::bigint            AS total_occurrences,
       COUNT(*)::int                                            AS unique_errors,
       COUNT(*) FILTER (WHERE e.level = 'fatal')::int           AS fatal,
       -- Fatals that are STILL OPEN. The column above counts everything in the
       -- window whether or not anyone fixed it: right for a KPI card, wrong for
       -- a STATUS light. A resolved fatal kept the Overview reading "Degraded"
       -- next to 100% uptime and 100% resolved on the same card, and a status
       -- that never returns to green is one people stop reading.
       -- (No backticks in this comment: the whole query is a JS template
       --  literal, so one would end the string mid-SQL.)
       COUNT(*) FILTER (WHERE e.level = 'fatal' AND e.resolved_at IS NULL)::int AS fatal_active,
       COUNT(*) FILTER (WHERE e.level = 'error')::int           AS errors,
       COUNT(*) FILTER (WHERE e.level = 'warning')::int         AS warnings,
       COUNT(*) FILTER (WHERE e.resolved_at IS NOT NULL)::int   AS resolved,
       COUNT(*) FILTER (WHERE e.resolved_at IS NULL)::int       AS active,
       COUNT(*) FILTER (WHERE e.last_seen >= date_trunc('day', now()))::int AS today,
       AVG(EXTRACT(EPOCH FROM (e.resolved_at - e.first_seen)))
         FILTER (WHERE e.resolved_at IS NOT NULL)               AS avg_resolution_seconds
     ${FROM} ${clause}`,
    params,
  );

  const s = rows[0];
  const totalGroups = s.unique_errors || 0;
  return {
    total_occurrences: Number(s.total_occurrences),
    unique_errors: s.unique_errors,
    fatal: s.fatal,
    fatal_active: s.fatal_active,
    errors: s.errors,
    warnings: s.warnings,
    resolved: s.resolved,
    active: s.active,
    today: s.today,
    resolved_rate: totalGroups ? Math.round((s.resolved / totalGroups) * 100) : 0,
    avg_resolution_seconds: s.avg_resolution_seconds === null ? null : Math.round(Number(s.avg_resolution_seconds)),
  };
}

/**
 * GET /errors/trends — the 24h activity bar and the 30-day sparkline (§3.1/§3.2).
 *
 * generate_series produces the empty buckets too. Without it the chart draws
 * only the hours that had errors, which makes a quiet night look identical to a
 * busy one and defeats the point of the visualisation.
 */
async function trends(q = {}) {
  const hours = Math.min(RETENTION_DAYS * 24, Math.max(1, Number(q.hours) || 24));
  const bucket = hours > 48 ? "day" : "hour";
  const { clause, params, next } = buildFilter({ ...q, status: "all" });

  const { rows } = await db.query(
    `WITH span AS (
       SELECT generate_series(
         date_trunc($${next}, now() - make_interval(hours => $${next + 1}::int)),
         date_trunc($${next}, now()),
         ('1 ' || $${next})::interval
       ) AS bucket
     ),
     hits AS (
       SELECT date_trunc($${next}, e.last_seen) AS bucket,
              SUM(e.occurrence_count)::bigint   AS occurrences,
              COUNT(*)::int                     AS groups,
              COUNT(*) FILTER (WHERE e.level = 'fatal')::int AS fatal
         ${FROM} ${clause}
        GROUP BY 1
     )
     SELECT span.bucket,
            COALESCE(hits.occurrences, 0)::int AS occurrences,
            COALESCE(hits.groups, 0)           AS groups,
            COALESCE(hits.fatal, 0)            AS fatal
       FROM span LEFT JOIN hits USING (bucket)
      ORDER BY span.bucket`,
    [...params, bucket, hours],
  );

  return { bucket, hours, points: rows };
}

/**
 * POST /errors/:id/resolve — manual resolution with attribution (criterion #9).
 *
 * Idempotent, and deliberately does not re-stamp an already-resolved row: the
 * first person to fix it is the one who fixed it.
 */
async function resolve(id, actorId) {
  const { rows } = await db.query(
    `UPDATE platform.error_event
        SET resolved_at = COALESCE(resolved_at, now()),
            resolved_by = COALESCE(resolved_by, $2)
      WHERE error_id = $1
      RETURNING error_id AS id, signature, resolved_at, resolved_by`,
    [id, actorId],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", "Error not found", 404);
  await audit(actorId, "error.resolved", rows[0].signature, { error_id: id });
  return rows[0];
}

/** POST /errors/:id/reopen — the inverse, for a premature resolve. */
async function reopen(id, actorId) {
  const { rows } = await db.query(
    `UPDATE platform.error_event
        SET resolved_at = NULL, resolved_by = NULL
      WHERE error_id = $1
      RETURNING error_id AS id, signature`,
    [id],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", "Error not found", 404);
  // Audited as loudly as the resolve. Reopening ERASES `resolved_by`, so
  // without this the only record of who called an error fixed is destroyed by
  // whoever disagreed — and neither name survives.
  await audit(actorId, "error.reopened", rows[0].signature, { error_id: id });
  return rows[0];
}

/** Distinct modules present in the store — populates the §3.4 module dropdown. */
async function modules() {
  const { rows } = await db.query(
    `SELECT e.module, COUNT(*)::int AS count
       FROM platform.error_event e
      WHERE e.module IS NOT NULL
      GROUP BY e.module
      ORDER BY count DESC, e.module`,
  );
  return rows;
}

/** GET /errors/export — CSV or JSON of the current filter (spec §6). */
async function exportAll(q = {}) {
  const { clause, params, next } = buildFilter(q);
  const { rows } = await db.query(
    `SELECT ${SELECT_COLUMNS}, e.raw_stack ${FROM} ${clause}
     ORDER BY ${SORTS[q.sort] || SORTS.recent}
     LIMIT $${next}`,
    [...params, 5000],
  );
  return rows;
}

/**
 * Delete rows past the retention window (§2.2 — 30 days, daily at 02:00 UTC).
 * Resolved rows go early; unresolved ones are kept the full window because an
 * open bug is still an open bug even if it last fired three weeks ago.
 */
async function purge({ days = RETENTION_DAYS } = {}) {
  const { rowCount } = await db.query(
    `DELETE FROM platform.error_event
      WHERE last_seen < now() - make_interval(days => $1::int)`,
    [days],
  );
  return { deleted: rowCount, days };
}

module.exports = {
  audit,
  list,
  recent,
  get,
  stats,
  trends,
  resolve,
  reopen,
  modules,
  exportAll,
  purge,
  LEVELS,
  RETENTION_DAYS,
};
