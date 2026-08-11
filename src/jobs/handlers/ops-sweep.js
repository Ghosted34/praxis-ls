/**
 * Kaizen ops sweeps (§3.1, §3.4, §3.5) — WS-H1/H2, WS-U1, WS-ER1.
 *
 * One queue, four behaviours, matching the shape the other schedulers use:
 *
 *   "health"  — snapshot every tenant's health into platform.tenant_health,
 *               including the synthetic per-tenant liveness probe (WS-H2).
 *   "uptime"  — probe every host over HTTP and record the sample (WS-U1).
 *   "alert"   — evaluate the current ops state and route what it warrants to a
 *               channel (WS-ER1). Separate from the sweeps that produce the
 *               data so that alerting cadence is tunable independently of
 *               collection cadence — you want to MEASURE often and NOTIFY
 *               rarely, and collapsing them forces one interval to be both.
 *   "purge"   — retention for the two time-series.
 *
 * NEVER THROWS on the collection paths. A failed probe is the data point; a
 * handler that rejects goes onto BullMQ's retry/backoff path and skips the very
 * samples that make an outage visible. Same reasoning as health-collect.js, and
 * the deliberate opposite of backup-run.js, where a failure IS the alert.
 */
"use strict";

const { logger } = require("../../config/logger");
const { config } = require("../../config/env");
const health = require("../../services/platform/health-rollup.service");
const uptime = require("../../services/platform/uptime.service");
const alerts = require("../../services/platform/alert-routing.service");
const entitlement = require("../../services/platform/entitlement.service");

module.exports = async function opsSweep(job) {
  const kind = job.name || "health";

  if (kind === "uptime") {
    try {
      const r = await uptime.probeAll();
      return { probed: r.probed, down: r.down };
    } catch (err) {
      logger.error({ err }, "uptime sweep failed");
      return { error: err.message };
    }
  }

  if (kind === "alert") {
    try {
      const raised = await alerts.evaluateAndAlert();
      return { raised: raised.length, undelivered: raised.filter((r) => !r.delivered).length };
    } catch (err) {
      logger.error({ err }, "ops alert evaluation failed");
      return { error: err.message };
    }
  }

  if (kind === "usage") {
    // WS-S3. Never throws: enforcement reads the last sweep's figures, so a
    // failed run costs freshness, not correctness — and a metering error must
    // not become a terminal job failure that pages someone at 3am over a
    // number nobody is looking at until the end of the month.
    try {
      const r = await entitlement.measureFleet();
      return { total: r.total, ok: r.ok, failed: r.failed.length };
    } catch (err) {
      logger.error({ err }, "usage metering sweep failed");
      return { error: err.message };
    }
  }

  if (kind === "purge") {
    const h = await health.purge({ days: 30 });
    // Config-driven so the API and the external prober (which applies retention
    // opportunistically on its own loop) cannot disagree about how much history
    // to keep — two owners with two hardcoded numbers is how a series ends up
    // truncated by whichever ran last.
    const u = await uptime.purge({ days: Number(config.UPTIME_RETAIN_DAYS || 90) });
    logger.info({ health: h.deleted, uptime: u.deleted }, "ops retention applied");
    return { health_deleted: h.deleted, uptime_deleted: u.deleted };
  }

  try {
    const r = await health.collectFleetHealth();
    return { total: r.total, red: r.red, amber: r.amber, green: r.green };
  } catch (err) {
    logger.error({ err }, "tenant health sweep failed");
    return { error: err.message };
  }
};
