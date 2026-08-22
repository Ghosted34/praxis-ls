/**
 * Worker job: the certified-signature quota watch. One sweep, daily.
 *
 * doc/SIGNATURE_ENGINEERING_GUIDE.md §7.5.
 *
 * ── WHAT IT MEASURES ───────────────────────────────────────────────────────
 * Envelopes ISSUED this calendar month, across all tenants — the ledger
 * rows, not the envelope rows: an envelope that failed before the provider
 * answered was never issued, and the free-tier allowance (which belongs to
 * the Praxis account, §7.5) is consumed by issues, not by attempts.
 *
 * Per-tenant databases mean the sweep walks the fleet: one count query per
 * tenant, one connection each, serially. The fleet is small by design and
 * the count is an indexed range scan, so the walk is a matter of seconds —
 * and it runs at 06:00 UTC, the one hour of the day it is safe to be slow.
 *
 * ── WHAT IT SAYS, AND WHEN ─────────────────────────────────────────────────
 * Two thresholds, 80% and 95%, to the PLATFORM alert-routing service — this
 * is the platform's allowance and the platform's number, and one tenant must
 * never see another's consumption, so it never touches a tenant channel.
 *
 * Each threshold fires ONCE per calendar month. The crossing is recorded in
 * the platform settings vault (`qes.quota_alerts`), and a new month resets
 * it. A quota alert that repeats every day at 06:00 for six weeks is the
 * alert that gets muted, and a muted quota alert is the one that is silent
 * the week the month actually runs out.
 *
 * ── WHY IT IS ONE JOB AND NOT A FAN-OUT ────────────────────────────────────
 * The answer is a SINGLE number (the fleet total), and splitting the
 * counting across per-tenant jobs would mean a second job to aggregate —
 * two jobs, a queue hop and a partial-failure story, to compute what one
 * serial loop computes in seconds. The per-tenant fan-out exists where the
 * WORK is per-tenant (the poll, the reminder); here only the reads are.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const platformSettings = require("../../services/platform/settings.service");
const alertRouting = require("../../services/platform/alert-routing.service");
const { logger } = require("../../config/logger");

const THRESHOLDS = [
  { pct: 95, key: "alerted95" }, // highest first: at 96% the 95 crossing is what matters
  { pct: 80, key: "alerted80" },
];

module.exports = async function qesQuota() {
  const { platformPricing } = require("../../services/qes");
  const pricing = await platformPricing();
  const quota = pricing.monthlyQuota;
  if (quota <= 0) {
    logger.debug("QES quota watch: no quota configured, nothing to watch");
    return { skipped: "no quota configured" };
  }

  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  // The previous month's crossings, if any — they do not carry over.
  const stateRow = await platformSettings.resolve("qes", "quota_alerts").catch(() => null);
  const state = (stateRow && stateRow.value && stateRow.value.month === month) ? stateRow.value : { month };

  const tenants = await registry.listActiveTenants();
  let total = 0;
  let counted = 0;
  let failed = 0;

  for (const meta of tenants) {
    try {
      const n = await registry.withTenantConnection(meta, "live", async (client) => {
        const { rows } = await client.query(
          `SELECT count(*)::int AS n FROM signature_usage_ledger
            WHERE date_trunc('month', created_at) = make_date($1, $2, 1)`,
          [now.getUTCFullYear(), now.getUTCMonth() + 1],
        );
        return rows[0] ? rows[0].n : 0;
      });
      total += n;
      counted += 1;
    } catch (err) {
      // A wedged tenant database must not stop the fleet count — but it
      // must be VISIBLE, because a quota number computed over a missing
      // tenant is a number that is quietly too low.
      failed += 1;
      logger.warn({ err: err && err.message, tenant: meta.db_name }, "[qes] quota count failed for tenant");
    }
  }

  const pct = Math.round((total / quota) * 100);
  logger.debug({ month, total, quota, pct, counted, failed }, "[qes] quota sweep");

  for (const { pct: threshold, key } of THRESHOLDS) {
    if (pct >= threshold && !state[key]) {
      state[key] = true;
      await platformSettings.put({ section: "qes", key: "quota_alerts", value: state }).catch(() => {
        /* @silent:storage — the alert below is the record; the state row is
           the dedupe, and a failed dedupe costs one repeated alert, not a
           missed one. */
      });
      await alertRouting.raise({
        event: "qes.quota_low",
        severity: "notify",
        subject: `Certified signature quota at ${pct}% of the monthly allowance (${total}/${quota} envelopes, ${month})`,
        detail: {
          total, quota, pct, month,
          tenants_counted: counted, tenants_failed: failed,
          threshold,
        },
      });
    }
  }

  return { month, total, quota, pct, counted, failed };
};
