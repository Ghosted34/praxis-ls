#!/usr/bin/env node
/**
 * WS-U1 — the EXTERNAL uptime prober.
 *
 * WHY THIS FILE EXISTS WHEN uptime.service.js ALREADY PROBES
 *
 *   The service can probe, and `ops-sweep.js` calls it on a schedule inside the
 *   API process. That arrangement cannot observe the one failure the whole
 *   workstream is about: the API process being down. A prober that shares a fate
 *   with the thing it measures writes no sample during an outage, and a metric
 *   that goes quiet when things break is worse than no metric — it goes silent
 *   at precisely the moment it was supposed to speak up.
 *
 *   `availability()` partly defends against this by dividing by EXPECTED samples
 *   rather than recorded ones, so a gap counts as downtime. But "we can infer
 *   the outage from the hole in the data" is a weaker claim than "we observed
 *   it", and it cannot distinguish an API outage from the prober being paused.
 *
 *   So: this is a separate process. It talks to the platform database and to the
 *   public hostnames over HTTP, and it shares nothing else with the API. Run it
 *   on another host — ideally in another region or on another provider — and a
 *   failed probe means the host is genuinely unreachable from somewhere real.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   It does not import the Express app, the job queue, Redis, or the tenant
 *   registry. The only shared code is `uptime.service` (probe + record) and the
 *   platform DB pool, because duplicating the sample-recording SQL would let the
 *   two writers drift apart and quietly produce two incompatible series.
 *
 * USAGE
 *   node scripts/ops/uptime-probe.js            # loop forever on the interval
 *   node scripts/ops/uptime-probe.js --once     # single sweep, then exit
 *   node scripts/ops/uptime-probe.js --purge    # apply retention, then exit
 *
 * Exit codes: 0 clean, 1 fatal (bad config, DB unreachable). A DOWN host is NOT
 * a non-zero exit — it is the measurement succeeding.
 */
"use strict";

const path = require("path");
// Load .env the same way the app does, so a bare `node scripts/ops/...` works
// on a box where the operator has not exported anything by hand.
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const uptime = require("../../src/services/platform/uptime.service");
const platformDb = require("../../src/services/platform/db");
const runtimeConfig = require("../../src/services/platform/runtime-config.service");
const { config } = require("../../src/config/env");
const { logger } = require("../../src/config/logger");

const args = new Set(process.argv.slice(2));
const ONCE = args.has("--once");
const PURGE_ONLY = args.has("--purge");
const INTERVAL_MS = Number(config.UPTIME_PROBE_INTERVAL_MS || 300_000);

/**
 * Retention is resolved from the platform settings vault, not from this
 * process's env.
 *
 * Both this prober and the API's own purge job delete from the same table. If
 * each read its own env, the two could disagree about how much history to keep
 * and the series would be truncated by whichever ran last — a silent, gradual
 * loss of exactly the historical data the availability figures are computed
 * from. One source, read at use time, removes the possibility.
 */
async function retainDays() {
  return Number((await runtimeConfig.opsTuning()).uptimeRetainDays);
}

let stopping = false;
let timer = null;

/**
 * One sweep. Never throws: a probe failure is data, and a database hiccup should
 * cost one sample rather than the whole prober. The one thing that must not
 * happen is the loop dying silently and leaving a hole that `availability()`
 * will later read as an outage that never occurred.
 */
async function sweep() {
  try {
    const r = await uptime.probeAll();
    if (r.down > 0) {
      logger.error({ probed: r.probed, down: r.down, hosts: r.results.filter((x) => !x.up).map((x) => x.host) },
        "external uptime sweep found hosts DOWN");
    } else {
      logger.info({ probed: r.probed }, "external uptime sweep clean");
    }
    return r;
  } catch (err) {
    logger.error({ err }, "external uptime sweep failed");
    return null;
  }
}

/**
 * Retention, run opportunistically once an hour rather than as its own cron.
 * One fewer moving part to schedule, and the prober is the only writer to this
 * table so it is the natural owner of the cleanup.
 */
let lastPurge = 0;
async function maybePurge() {
  if (Date.now() - lastPurge < 3_600_000) return;
  lastPurge = Date.now();
  try {
    const days = await retainDays();
    const { deleted } = await uptime.purge({ days });
    if (deleted) logger.info({ deleted, retain_days: days }, "uptime retention applied");
  } catch (err) {
    logger.warn({ err }, "uptime retention failed — will retry next hour");
  }
}

async function loop() {
  while (!stopping) {
    const started = Date.now();
    await sweep();
    await maybePurge();

    // Interval measured from the START of the sweep, not the end. A sweep that
    // takes 40s should not push the next one to 5m40s — the availability maths
    // assumes a fixed cadence, and drifting sample spacing quietly biases it.
    const wait = Math.max(1000, INTERVAL_MS - (Date.now() - started));
    if (stopping) break;
    await new Promise((resolve) => {
      timer = setTimeout(resolve, wait);
    });
  }
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "uptime prober shutting down");
  if (timer) clearTimeout(timer);
  try {
    await platformDb.close?.();
  } catch {
    /* closing a pool during shutdown is best-effort */
  }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

(async function main() {
  if (!config.DATABASE_URL && !config.DB_HOST) {
    logger.error("no database configuration — the prober writes samples to the platform DB and cannot start without it");
    process.exit(1);
  }

  if (PURGE_ONLY) {
    const { deleted } = await uptime.purge({ days: await retainDays() });
    logger.info({ deleted }, "uptime retention applied");
    return shutdown("purge");
  }

  const targets = await uptime.probeTargets().catch((err) => {
    logger.error({ err }, "could not read probe targets from the platform database");
    process.exit(1);
  });

  // Log the RESOLVED settings, not env. These are vault-first now, so printing
  // the env values at startup would tell an operator the prober is using
  // something it is not — the most expensive kind of log line.
  const tuning = await runtimeConfig.opsTuning();
  logger.info(
    {
      targets: targets.length,
      interval_ms: INTERVAL_MS,
      timeout_ms: tuning.uptimeProbeTimeoutMs,
      path: tuning.uptimeProbePath,
      scheme: tuning.uptimeProbeScheme,
      settings_from: tuning.source,
      mode: ONCE ? "once" : "loop",
    },
    "external uptime prober starting",
  );

  if (!targets.length) {
    logger.warn("no probe targets — no LIVE tenant has a primary subdomain and PLATFORM_HOST is unset");
  }

  if (ONCE) {
    await sweep();
    return shutdown("once");
  }
  await loop();
})().catch((err) => {
  logger.error({ err }, "uptime prober failed to start");
  process.exit(1);
});
