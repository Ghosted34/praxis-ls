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

// INCIDENT 2026-08-12 — this service is BACKGROUND work, so it draws from the
// ops pool, not the pool that serves requests. Sharing one pool let the fleet
// sweeps exhaust the connections tenant logins needed for credential
// resolution, and every tenant login timed out. A sweep may be slow; it may
// not make a user request slow. See services/platform/db.js.
const _db = require("./db");
// Resolved per call, and tolerant of a double that stubs only `query`: the
// unit tests replace this whole module, and which POOL a query used is not
// what they are asserting — the SQL is. Production always exports both.
const platformDb = { query: (t, p) => (_db.opsQuery || _db.query)(t, p) };
const registry = require("../tenant/registry.service");
// Lazily required inside the functions that use it: alert-routing pulls in
// platform mail and settings, and requiring it at module load creates a cycle
// through the settings service back to here.
const alerts = {
  raise: (...a) => require("./alert-routing.service").raise(...a),
};
const { logger } = require("../../config/logger");
const { config } = require("../../config/env");
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
  // An operator raising a limit to unblock a customer must not be told to wait
  // out a TTL. Cleared wholesale rather than per tenant: entitlements are keyed
  // by PLAN, so one write can change the answer for every tenant on it, and
  // resolving which ones costs a query to save a handful of cheap misses.
  invalidateStatus();
  return rows[0];
}

async function removeEntitlement(planId, metric) {
  const { rowCount } = await platformDb.query(
    "DELETE FROM platform.plan_entitlement WHERE plan_id=$1 AND metric=$2",
    [planId, metric],
  );
  // Removing an entitlement makes the metric UNLIMITED again. Leaving a stale
  // cached limit in place would keep blocking an action that is no longer
  // capped — the worst direction for this to be wrong in.
  invalidateStatus();
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
  return decide(await statusFor(tenantId), metric, { additional, liveUsed });
}

/**
 * The verdict, given already-resolved status rows.
 *
 * Split out of `check` so that `check` (always fresh) and `guard` (short-TTL
 * cached) cannot drift apart on what counts as a breach. Two copies of this
 * decision is exactly how "the console says they are over and the API let them
 * through" happens.
 *
 * Synchronous and pure: it is the piece most worth being able to test with a
 * plain array.
 */
function decide(rows, metric, { additional = 0, liveUsed = null } = {}) {
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

/* ── The guard every enforcement point calls ─────────────────────────────── */

/**
 * Soft-breach alerts are deduplicated in-process.
 *
 * A soft limit is breached on EVERY subsequent action — a tenant 10 over their
 * email allowance raises it once per send. Alerting on each would bury the
 * channel and train people to filter the whole class, which is how a soft limit
 * becomes invisible. One notice per tenant/metric/period is the useful rate: the
 * console already carries the running number for anyone who wants detail.
 *
 * In-process and unbounded-by-time is fine: the key includes the period, so the
 * map turns over monthly, and a restart re-alerting once is not a problem worth
 * a table.
 */
const softAlerted = new Set();

/**
 * Short-lived cache of `statusFor`, read only by `guard`.
 *
 * WHY THIS IS NOT OPTIONAL.
 *
 *   `guard` runs at the point of an action, and one of those points is every
 *   outbound email — invoices, OTPs, notifications. Uncached, that put a
 *   PLATFORM-database round trip on the hot path of the busiest thing the mail
 *   sender does, for a check whose answer cannot even stop the send.
 *
 *   INCIDENT 2026-08-12 is the precedent and it is close enough to be a warning
 *   rather than an analogy: the Kaizen sweeps saturated the platform database,
 *   tenant credential resolution queued behind it, and tenant LOGINS timed out.
 *   Adding an unbounded per-email query to the same database is how that comes
 *   back.
 *
 * WHY A CACHE COSTS NOTHING IN ACCURACY.
 *
 *   `tenant_usage` is written by the metering SWEEP, not by the actions being
 *   guarded, so this data already changes only at sweep cadence — the service
 *   docstring says so: "enforcement is as fresh as the last meter run." Caching
 *   it for a minute cannot make it staler than it already is. The one figure
 *   that must be live is the seat count, and that arrives as `liveUsed` from a
 *   caller already holding the tenant connection, so it bypasses this entirely.
 *
 *   The LIMIT half can change at any moment from the console, which is why
 *   `setEntitlement`/`removeEntitlement` clear this rather than waiting it out:
 *   an operator who raises a limit to unblock a customer must not be told to
 *   wait sixty seconds.
 */
const statusCache = new Map();
const STATUS_TTL_MS = Number(config.ENTITLEMENT_STATUS_TTL_MS || 60_000);

async function statusForCached(tenantId) {
  const key = `${tenantId}:${currentPeriod()}`;
  const hit = statusCache.get(key);
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.rows;

  const rows = await statusFor(tenantId);
  statusCache.set(key, { rows, at: Date.now() });

  // The key carries the period, so entries turn over monthly rather than
  // growing without bound — but a long-lived process with many tenants would
  // still accumulate one entry each. Cheap, bounded sweep on write.
  if (statusCache.size > 500) {
    const cutoff = Date.now() - STATUS_TTL_MS;
    for (const [k, v] of statusCache) if (v.at < cutoff) statusCache.delete(k);
  }
  return rows;
}

/** Drop cached entitlement status. Called whenever a limit changes. */
function invalidateStatus() {
  statusCache.clear();
}

/**
 * Enforcement, with the failure semantics every call site should share.
 *
 * ── WHY THIS FAILS CLOSED ──────────────────────────────────────────────────
 *
 *   The seat check used to swallow any non-breach error and allow the action,
 *   reasoning that a platform-side hiccup should not stop the whole fleet
 *   onboarding staff. That reasoning is sound and the implementation was not:
 *   a check that yields whenever it cannot run is indistinguishable, from the
 *   outside, from a check that ran and passed. The one condition under which
 *   enforcement is most likely to be needed — something wrong on the platform
 *   side — was the one condition under which it did not happen, silently.
 *
 *   So: an unevaluable check BLOCKS, with a distinct 503 that says so, and
 *   raises a `page` alert. The trade is explicit and worth stating plainly,
 *   because it is a real cost: while the platform database is unreachable,
 *   entitlement-gated actions are refused. That is a visible, attributable,
 *   short outage of specific features, and it is preferable to an invisible,
 *   open-ended hole in the thing that will eventually gate revenue.
 *
 *   The blast radius is deliberately small. Only actions that pass through a
 *   guard are affected, only tenants whose plan actually carries a limit reach
 *   the throw, and `ENTITLEMENT_CHECK_UNAVAILABLE` is distinct from
 *   `ENTITLEMENT_EXCEEDED` so an operator can tell "over their plan" from
 *   "we cannot tell" without reading logs.
 *
 * `neverBlock` downgrades a hard breach to a soft one for callers where
 * blocking is the wrong answer regardless of configuration — see the mail
 * sender, which documents why.
 */
async function guard(
  tenantId,
  metric,
  { additional = 0, liveUsed = null, slug = null, action = null, neverBlock = false } = {},
) {
  // No tenant resolved. This is not a policy question — it means the caller
  // could not identify who is acting, which is a programming error, not a
  // tenant over their plan. Allow, and say so loudly: turning it into a block
  // would break platform-level and unauthenticated paths that legitimately have
  // no tenant.
  if (!tenantId) {
    logger.debug({ metric, action }, "entitlement guard skipped — no tenant on the connection");
    return { allowed: true, metric, limit: null, reason: "no tenant context" };
  }

  let result;
  try {
    // Reads through the short-TTL cache rather than calling `check` directly —
    // see `statusCache` for why a per-action platform query is a hazard here.
    // `check` itself stays uncached: it is the primitive, and a caller that
    // wants a guaranteed-fresh read should get one.
    const rows = await statusForCached(tenantId);
    result = decide(rows, metric, { additional, liveUsed });
  } catch (err) {
    // A real breach is the answer, not a failure. Pass it straight through.
    if (err && err.code === "ENTITLEMENT_EXCEEDED") {
      if (!neverBlock) throw err;
      // neverBlock: the caller has declared that blocking is worse than
      // overage. Record it as a soft breach and continue.
      await notifySoft(tenantId, metric, { slug, action, forced: true });
      return { allowed: true, metric, exceeded_soft: true, downgraded_from_hard: true };
    }

    // Anything else means the check could not be evaluated.
    await alerts
      .raise({
        event: "entitlement.unavailable",
        subject: `entitlement check failed for ${metric}`,
        tenant: slug,
        detail: { metric, action, error: err && err.message },
      })
      .catch(() => {});

    if (neverBlock) {
      logger.warn({ err, metric, slug }, "entitlement check unavailable — allowing (neverBlock)");
      return { allowed: true, metric, limit: null, reason: "check unavailable" };
    }

    throw new AppError(
      "ENTITLEMENT_CHECK_UNAVAILABLE",
      "Plan limits cannot be verified right now, so this action was not completed. " +
        "This is a platform-side fault, not a problem with your account — please retry shortly.",
      // 503, not 402: nothing is known about the tenant's plan position. Telling
      // a tenant they are over a limit that was never read would be a lie, and
      // one they might pay to resolve.
      503,
      { metric, action },
    );
  }

  if (result.exceeded_soft) await notifySoft(tenantId, metric, { slug, action });
  return result;
}

/** Raise a soft-breach notice at most once per tenant/metric/period. */
async function notifySoft(tenantId, metric, { slug = null, action = null, forced = false } = {}) {
  const key = `${tenantId}:${metric}:${currentPeriod()}`;
  if (softAlerted.has(key)) return;
  softAlerted.add(key);

  const spec = METRICS[metric] || {};
  await alerts
    .raise({
      event: "entitlement.soft_exceeded",
      subject: `${slug || tenantId} is over its ${spec.label || metric} allowance`,
      tenant: slug,
      detail: {
        metric,
        action,
        // Says out loud that nothing was blocked, because the natural reading of
        // an alert about a limit is that something stopped working.
        enforced: false,
        note: forced
          ? "limit is configured hard, but this call site never blocks — see the caller"
          : "soft limit: the action proceeded",
      },
    })
    .catch(() => {});
}

/**
 * Clear the soft-alert memo AND the status cache.
 *
 * Both, because they are the two pieces of in-process state here and a test
 * that resets one but not the other leaks the other between cases — which
 * fails in the confusing direction, where a test passes alone and not in a
 * suite.
 */
function resetSoftAlerts() {
  softAlerted.clear();
  invalidateStatus();
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
  decide,
  guard,
  invalidateStatus,
  notifySoft,
  resetSoftAlerts,
  fleetUsage,
};
