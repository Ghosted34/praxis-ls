/**
 * WS-S3 — entitlement, metering and enforcement (INFRASTRUCTURE_PLAN §5).
 *
 * Feature gating answers "may this tenant use the invoicing module". This
 * answers "how much of what they are paying for have they used", which is the
 * question that turns a plan from a marketing document into a control, and the
 * one billing eventually reads.
 *
 * SCOPE (decision D5): spend + seats first, because that data already exists —
 * `ai_usage_ledger` per tenant and `app_user` respectively. Storage and email
 * follow the same shape and are wired here too, since the meter interface made
 * them nearly free; they are simply not what the first plans sell on.
 *
 * ── THE RULE THAT MATTERS MOST ─────────────────────────────────────────────
 *
 *   A hard limit blocks the SPECIFIC ACTION with a typed ENTITLEMENT_EXCEEDED,
 *   never a generic 500 and never a silent no-op. This mirrors how
 *   `requireFeature` already gates: the caller learns exactly what they hit and
 *   what to do about it. An entitlement failure that surfaces as a 500 is
 *   indistinguishable from a bug, and it will be reported as one.
 *
 * ── WHY ENFORCEMENT READS CACHED USAGE, NOT A LIVE COUNT ───────────────────
 *
 *   `check()` sits in front of user actions — adding a seat, sending mail — so
 *   it must be cheap. Counting `app_user` across a tenant DB on every call
 *   would put a cross-database query on the critical path of the exact
 *   operations a busy tenant does most.
 *
 *   Consequence, stated plainly: enforcement is as fresh as the last meter run.
 *   A tenant can momentarily exceed a hard limit between sweeps. That is the
 *   right trade for seats and spend — the overshoot is one or two units and
 *   self-corrects — and it is why `measure()` runs on a schedule rather than
 *   being something the console triggers by hand.
 *
 *   The exception is `seats`, where `check()` accepts a live count from the
 *   caller that already has the tenant connection open: the one place the
 *   freshness is free.
 */
"use strict";

const platformDb = require("./db");
const registry = require("../tenant/registry.service");
const { logger } = require("../../config/logger");
const { AppError } = require("../../utils/errors");

/**
 * Metric catalogue.
 *
 * `kind` is the distinction that governs everything downstream:
 *   level — a measurement of right now (seats, gigabytes). The meter REPLACES
 *           the period's value.
 *   flow  — an accumulation over the period (spend, emails). The meter SUMS
 *           within the period.
 *
 * Getting this wrong is subtle and expensive: summing a level metric across a
 * month multiplies a tenant's seat count by the number of times it was
 * measured, and replacing a flow metric silently discards everything before the
 * last sweep.
 */
const METRICS = {
  seats: { kind: "level", label: "Seats", unit: "users", metered: true },
  ai_spend_xaf: { kind: "flow", label: "AI spend", unit: "XAF", metered: true },
  emails_month: { kind: "flow", label: "Emails sent", unit: "emails", metered: true },
  // DECLARED BUT NOT METERED, and deliberately so.
  //
  // `document_vault` records a storage_path and a content hash but NO byte
  // size, so there is nothing to sum. Measuring it properly means stat-ing
  // every object through the storage driver on every sweep — O(objects) per
  // tenant — or adding a size column and backfilling it, which is a schema
  // change that belongs with the storage work rather than smuggled in here.
  //
  // D5 scoped this pass to spend + seats with storage to follow, so the metric
  // exists (an entitlement can be set against it, and it renders) and simply
  // reports no usage until a meter is written. That is honest; inventing an
  // approximation would produce a number someone would eventually bill on.
  storage_gb: { kind: "level", label: "Storage", unit: "GB", metered: false },
};

/** The first of the current month — the bucket every usage row lands in. */
function currentPeriod(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

/* ── Entitlements (what a plan grants) ───────────────────────────────────── */

async function listEntitlements(planId) {
  const { rows } = await platformDb.query(
    `SELECT plan_id, metric, limit_value, hard, updated_at
       FROM platform.plan_entitlement
      WHERE ($1::uuid IS NULL OR plan_id = $1)
      ORDER BY metric`,
    [planId || null],
  );
  return rows;
}

async function setEntitlement({ planId, metric, limitValue, hard = false }) {
  if (!METRICS[metric]) {
    throw new AppError("UNKNOWN_METRIC", `No such metric "${metric}"`, 422, {
      known: Object.keys(METRICS),
    });
  }
  const { rows } = await platformDb.query(
    `INSERT INTO platform.plan_entitlement (plan_id, metric, limit_value, hard)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (plan_id, metric)
       DO UPDATE SET limit_value = EXCLUDED.limit_value, hard = EXCLUDED.hard, updated_at = now()
     RETURNING *`,
    [planId, metric, limitValue, hard],
  );
  return rows[0];
}

async function removeEntitlement(planId, metric) {
  const { rowCount } = await platformDb.query(
    "DELETE FROM platform.plan_entitlement WHERE plan_id=$1 AND metric=$2",
    [planId, metric],
  );
  return rowCount > 0;
}

/* ── Meters (what a tenant has used) ─────────────────────────────────────── */

/**
 * Record a measurement.
 *
 * `level` replaces, `flow` adds. See the METRICS note for why conflating them
 * silently corrupts both.
 */
async function record(tenantId, metric, value, { period = currentPeriod() } = {}) {
  const spec = METRICS[metric];
  if (!spec) throw new Error(`unknown metric "${metric}"`);

  const setClause =
    spec.kind === "flow"
      ? "used = platform.tenant_usage.used + EXCLUDED.used"
      : "used = EXCLUDED.used";

  const { rows } = await platformDb.query(
    `INSERT INTO platform.tenant_usage (tenant_id, metric, period, used, measured_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (tenant_id, metric, period)
       DO UPDATE SET ${setClause}, measured_at = now()
     RETURNING *`,
    [tenantId, metric, period, value],
  );
  return rows[0];
}

/** Measure the LEVEL metrics for one tenant by reading its database. */
async function measureTenant(meta) {
  const out = {};

  const period = currentPeriod();

  /**
   * Write a re-derived figure.
   *
   * Every meter below RE-READS its source rather than incrementing, so running
   * the sweep twice cannot double a tenant's bill. That matters more than it
   * sounds: a retried job, an operator pressing the button, and a scheduler
   * firing twice after a restart are all normal, and a metering system that
   * inflates under any of them is one nobody will trust enough to invoice from.
   * So even the FLOW metrics are written as replacements here.
   */
  const put = (metric, value) =>
    platformDb.query(
      `INSERT INTO platform.tenant_usage (tenant_id, metric, period, used, measured_at)
       VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (tenant_id, metric, period)
         DO UPDATE SET used = EXCLUDED.used, measured_at = now()`,
      [meta.tenant_id, metric, period, value],
    );

  try {
    // Seats: users who can actually sign in. Counting every row would bill a
    // tenant for people they suspended, which is the complaint that makes a
    // metering system distrusted on day one.
    const seats = await registry.withTenantConnection(meta, "live", async (client) => {
      const { rows } = await client.query(
        "SELECT count(*)::int AS n FROM app_user WHERE status = 'ACTIVE'",
      );
      return rows[0].n;
    });
    await put("seats", seats);
    out.seats = seats;
  } catch (err) {
    logger.warn({ err, slug: meta.slug }, "seat meter failed");
  }

  try {
    // AI spend, re-summed from the ledger — which is the source of truth and is
    // append-only, so re-reading it is both safe and exact.
    const spend = await registry.withTenantConnection(meta, "live", async (client) => {
      const { rows } = await client.query(
        `SELECT COALESCE(sum(cost_xaf), 0)::numeric AS c
           FROM ai_usage_ledger
          WHERE occurred_at >= $1::date AND occurred_at < ($1::date + interval '1 month')`,
        [period],
      );
      return Number(rows[0].c);
    });
    await put("ai_spend_xaf", spend);
    out.ai_spend_xaf = spend;
  } catch (err) {
    logger.warn({ err, slug: meta.slug }, "AI spend meter failed");
  }

  try {
    // Email volume. Counts what was actually accepted for delivery, not what
    // was queued — a queued-then-failed message consumed no provider quota and
    // billing for it would be wrong.
    const emails = await registry.withTenantConnection(meta, "live", async (client) => {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n
           FROM email_send_log
          WHERE status IN ('SENT','DELIVERED')
            AND queued_at >= $1::date AND queued_at < ($1::date + interval '1 month')`,
        [period],
      );
      return rows[0].n;
    });
    await put("emails_month", emails);
    out.emails_month = emails;
  } catch (err) {
    logger.warn({ err, slug: meta.slug }, "email meter failed");
  }

  return out;
}

/** Measure every live tenant. Never throws — one bad tenant must not stop the sweep. */
async function measureFleet() {
  const tenants = await registry.listActiveTenants();
  let ok = 0;
  const failed = [];
  for (const meta of tenants) {
    try {
      await measureTenant(meta);
      ok += 1;
    } catch (err) {
      logger.error({ err, slug: meta.slug }, "usage metering failed for tenant");
      failed.push(meta.slug);
    }
  }
  logger.info({ total: tenants.length, ok, failed: failed.length }, "usage metering sweep complete");
  return { total: tenants.length, ok, failed };
}

/* ── Resolution and enforcement ──────────────────────────────────────────── */

/**
 * Usage vs entitlement for one tenant.
 *
 * A metric with no entitlement row is UNLIMITED, not zero. This is the default
 * that keeps the system safe to deploy: until someone sets a limit, nothing is
 * capped, and a half-configured plan cannot lock a paying tenant out of adding
 * a user.
 */
async function statusFor(tenantId, { period = currentPeriod() } = {}) {
  const { rows } = await platformDb.query(
    `SELECT COALESCE(u.metric, e.metric)      AS metric,
            COALESCE(u.used, 0)               AS used,
            e.limit_value,
            e.hard,
            u.measured_at
       FROM platform.tenant t
       LEFT JOIN platform.plan_entitlement e ON e.plan_id = t.plan_id
       LEFT JOIN platform.tenant_usage u
              ON u.tenant_id = t.tenant_id
             AND u.period = $2
             AND (e.metric IS NULL OR u.metric = e.metric)
      WHERE t.tenant_id = $1
        AND COALESCE(u.metric, e.metric) IS NOT NULL`,
    [tenantId, period],
  );

  return rows.map((r) => {
    const limit = r.limit_value === null || r.limit_value === undefined ? null : Number(r.limit_value);
    const used = Number(r.used);
    const spec = METRICS[r.metric] || {};
    return {
      metric: r.metric,
      label: spec.label || r.metric,
      unit: spec.unit || null,
      used,
      limit,
      hard: Boolean(r.hard),
      measured_at: r.measured_at || null,
      // Null limit = unlimited, so a percentage would be meaningless rather
      // than zero.
      pct: limit && limit > 0 ? Math.round((used / limit) * 1000) / 10 : null,
      over: limit !== null && used > limit,
      // 80% is the point at which telling someone is still useful. Below that
      // it is noise; at 100% it is too late to be a warning.
      warning: limit !== null && limit > 0 && used >= limit * 0.8 && used <= limit,
    };
  });
}

/**
 * The enforcement gate. Throws ENTITLEMENT_EXCEEDED on a breached HARD limit.
 *
 * `additional` is what the caller is about to consume — 1 for adding a seat —
 * so the check is "would this action take them over", not "are they already
 * over". Checking after the fact permits exactly one breach every time.
 *
 * `liveUsed` lets a caller that already holds the tenant connection pass a
 * fresh count instead of the last sweep's. Used by the seat path, where the
 * accuracy is free.
 *
 * Never throws for a SOFT limit — that is the entire difference between the two,
 * and the caller learns about it from the returned object.
 */
async function check(tenantId, metric, { additional = 0, liveUsed = null } = {}) {
  const rows = await statusFor(tenantId);
  const row = rows.find((r) => r.metric === metric);

  // No entitlement configured = unlimited. Deliberately permissive: an
  // unconfigured plan must not lock anyone out.
  if (!row || row.limit === null) return { allowed: true, metric, limit: null };

  const used = liveUsed === null ? row.used : Number(liveUsed);
  const after = used + Number(additional || 0);
  const within = after <= row.limit;

  if (!within && row.hard) {
    throw new AppError(
      "ENTITLEMENT_EXCEEDED",
      `${row.label} limit reached (${row.limit} ${row.unit || ""}).`.replace(/\s+\)/, ")") +
        " Upgrade the plan or free some up to continue.",
      // 402 Payment Required: this is a commercial limit, not a permission
      // problem (403) and not a malformed request (422). It is the one status
      // that tells a client "this is about the plan" without further parsing.
      402,
      { metric, used, limit: row.limit, requested: Number(additional || 0) },
    );
  }

  return {
    allowed: true,
    metric,
    used,
    after,
    limit: row.limit,
    hard: row.hard,
    // A soft breach is reported, not thrown. The caller decides whether to
    // surface a banner; the action proceeds either way.
    exceeded_soft: !within && !row.hard,
  };
}

/** Fleet roll-up for the console and for whatever eventually bills. */
async function fleetUsage({ period = currentPeriod() } = {}) {
  const { rows } = await platformDb.query(
    `SELECT t.slug, t.tenant_id, p.code AS plan,
            u.metric, u.used, u.measured_at,
            e.limit_value, e.hard
       FROM platform.tenant t
       LEFT JOIN platform.plan p ON p.plan_id = t.plan_id
       LEFT JOIN platform.tenant_usage u ON u.tenant_id = t.tenant_id AND u.period = $1
       LEFT JOIN platform.plan_entitlement e ON e.plan_id = t.plan_id AND e.metric = u.metric
      WHERE t.status = 'LIVE'
      ORDER BY t.slug, u.metric`,
    [period],
  );

  const byTenant = new Map();
  for (const r of rows) {
    if (!byTenant.has(r.slug)) {
      byTenant.set(r.slug, { slug: r.slug, tenant_id: r.tenant_id, plan: r.plan, metrics: [] });
    }
    if (!r.metric) continue;
    const limit = r.limit_value === null ? null : Number(r.limit_value);
    const used = Number(r.used);
    const spec = METRICS[r.metric] || {};
    byTenant.get(r.slug).metrics.push({
      metric: r.metric,
      label: spec.label || r.metric,
      unit: spec.unit || null,
      used,
      limit,
      hard: Boolean(r.hard),
      measured_at: r.measured_at,
      pct: limit && limit > 0 ? Math.round((used / limit) * 1000) / 10 : null,
      over: limit !== null && used > limit,
    });
  }

  const tenants = [...byTenant.values()];
  return {
    period,
    tenants,
    over: tenants
      .filter((t) => t.metrics.some((m) => m.over))
      .map((t) => ({ slug: t.slug, metrics: t.metrics.filter((m) => m.over).map((m) => m.metric) })),
  };
}

module.exports = {
  METRICS,
  currentPeriod,
  listEntitlements,
  setEntitlement,
  removeEntitlement,
  record,
  measureTenant,
  measureFleet,
  statusFor,
  check,
  fleetUsage,
};
