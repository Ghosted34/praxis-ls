/**
 * WS-U1 — uptime probing and the status-page figures.
 *
 * THE POINT OF PROBING FROM OUTSIDE
 *
 *   Internal metrics cannot see "the process is down". This is the same flaw
 *   0093 documents for `health_sample` and solves by counting EXPECTED samples
 *   rather than recorded ones: a collector inside the thing it measures writes
 *   no row at all during an outage, so a naive `avg(up)` reports 100% for the
 *   week you were paged three times.
 *
 *   This module probes over HTTP, per host, so it at least crosses the network
 *   stack and the router rather than asking the process about itself. Running
 *   the prober outside the deployment entirely is a deployment decision — point
 *   `UPTIME_PROBE_BASE` at the public hostnames and run this from a worker in
 *   another region, or call `probeAll()` from an external cron. The maths below
 *   is honest either way because it uses the same expected-samples denominator.
 *
 * WHY availability USES EXPECTED SAMPLES
 *
 *   uptime% = up_samples / expected_samples, where expected is derived from the
 *   window and the probe interval. A missing sample counts as DOWN. Any other
 *   choice makes the metric blind to the outages that stopped it recording,
 *   which are precisely the outages worth measuring.
 */
"use strict";

const platformDb = require("./db");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");

const PROBE_TIMEOUT_MS = Number(config.UPTIME_PROBE_TIMEOUT_MS || 10_000);
const PROBE_PATH = config.UPTIME_PROBE_PATH || "/api/health/ready";

/** Every host worth probing: each tenant's primary subdomain, plus the platform host. */
async function probeTargets() {
  const { rows } = await platformDb.query(
    `SELECT s.host, t.tenant_id, t.slug
       FROM platform.subdomain s
       JOIN platform.tenant t ON t.tenant_id = s.tenant_id
      WHERE s.is_primary AND t.status='LIVE'
      ORDER BY s.host`,
  );
  const targets = rows.map((r) => ({ host: r.host, tenant_id: r.tenant_id, slug: r.slug }));
  if (config.PLATFORM_HOST) {
    targets.push({ host: config.PLATFORM_HOST, tenant_id: null, slug: null });
  }
  return targets;
}

/**
 * Probe one host. Never throws — a failed probe is the data, not an error, so
 * letting it reject would drop the very sample that records the outage.
 */
async function probeHost(target) {
  const scheme = config.UPTIME_PROBE_SCHEME || "https";
  const url = `${scheme}://${target.host}${PROBE_PATH}`;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "manual",
      headers: { "user-agent": "praxis-uptime-probe" },
    });
    const latency = Date.now() - started;
    // /health/ready returns 200 for ready AND degraded by design — a degraded
    // but servable process IS up for the purposes of this number. Only a
    // non-2xx counts as down.
    const up = res.status >= 200 && res.status < 300;
    return { ...target, up, status_code: res.status, latency_ms: latency, error: null };
  } catch (err) {
    return {
      ...target,
      up: false,
      status_code: null,
      // No latency on a failed probe: recording the timeout duration as latency
      // would make the average look worse the longer the timeout is set.
      latency_ms: null,
      error: err.name === "AbortError" ? `timeout after ${PROBE_TIMEOUT_MS}ms` : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Probe every target and record the samples. */
async function probeAll() {
  const targets = await probeTargets();
  const results = [];

  // Parallel: these are network waits, not CPU, and a serial sweep of fifty
  // hosts at a ten-second timeout could exceed the probe interval itself —
  // which would silently thin the sample rate the uptime maths assumes.
  const settled = await Promise.all(targets.map((t) => probeHost(t)));

  for (const r of settled) {
    try {
      await platformDb.query(
        `INSERT INTO platform.uptime_sample (host, tenant_id, up, status_code, latency_ms, error)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [r.host, r.tenant_id, r.up, r.status_code, r.latency_ms, r.error],
      );
    } catch (err) {
      logger.error({ err, host: r.host }, "could not record uptime sample");
    }
    results.push(r);
    if (!r.up) logger.error({ host: r.host, error: r.error }, "uptime probe DOWN");
  }

  const down = results.filter((r) => !r.up);
  logger.info({ probed: results.length, down: down.length }, "uptime sweep complete");
  return { probed: results.length, down: down.length, results };
}

/**
 * Availability per host over a window.
 *
 * Denominator is EXPECTED samples, not recorded ones — see the header. `expected`
 * is clamped to the count of recorded samples' span for a freshly deployed
 * system, so a deployment that started probing an hour ago does not report 4%
 * for the month.
 */
async function availability({ days = 30 } = {}) {
  const intervalMs = Number(config.UPTIME_PROBE_INTERVAL_MS || 300_000);
  const { rows } = await platformDb.query(
    `SELECT host,
            min(tenant_id::text) AS tenant_id,
            count(*)::int                        AS recorded,
            count(*) FILTER (WHERE up)::int      AS up_samples,
            min(probed_at)                       AS first_at,
            max(probed_at)                       AS last_at,
            avg(latency_ms) FILTER (WHERE up)    AS avg_latency_ms
       FROM platform.uptime_sample
      WHERE probed_at > now() - ($1 || ' days')::interval
      GROUP BY host
      ORDER BY host`,
    [String(days)],
  );

  const windowMs = days * 86_400_000;
  return rows.map((r) => {
    const spanMs = Math.min(windowMs, new Date(r.last_at) - new Date(r.first_at) + intervalMs);
    const expected = Math.max(r.recorded, Math.round(spanMs / intervalMs));
    return {
      host: r.host,
      tenant_id: r.tenant_id,
      recorded: r.recorded,
      expected,
      up_samples: r.up_samples,
      // Missing samples count against you: they are the outages that stopped
      // the prober.
      availability_pct: expected ? Math.round((r.up_samples / expected) * 10000) / 100 : null,
      avg_latency_ms: r.avg_latency_ms ? Math.round(Number(r.avg_latency_ms)) : null,
      first_at: r.first_at,
      last_at: r.last_at,
    };
  });
}

/**
 * Collapse consecutive down samples into incidents.
 *
 * A status page that lists three hundred individual failed probes is unreadable;
 * what a reader wants is "acme.praxisls.com was down for 25 minutes on the 4th".
 */
async function incidents({ days = 30 } = {}) {
  const { rows } = await platformDb.query(
    `SELECT host, probed_at, up, error
       FROM platform.uptime_sample
      WHERE probed_at > now() - ($1 || ' days')::interval
      ORDER BY host, probed_at`,
    [String(days)],
  );

  const out = [];
  let current = null;
  for (const r of rows) {
    if (!r.up) {
      if (current && current.host === r.host) {
        current.until = r.probed_at;
        current.samples++;
      } else {
        if (current) out.push(current);
        current = { host: r.host, from: r.probed_at, until: r.probed_at, samples: 1, error: r.error };
      }
    } else if (current && current.host === r.host) {
      out.push({ ...current, resolved: true });
      current = null;
    }
  }
  if (current) out.push({ ...current, resolved: false });

  return out
    .map((i) => ({
      ...i,
      duration_minutes: Math.round((new Date(i.until) - new Date(i.from)) / 60000),
    }))
    .sort((a, b) => new Date(b.from) - new Date(a.from));
}

/** Retention. Uptime history is kept longer than health: it feeds monthly reports. */
async function purge({ days = 90 } = {}) {
  const { rowCount } = await platformDb.query(
    `DELETE FROM platform.uptime_sample WHERE probed_at < now() - ($1 || ' days')::interval`,
    [String(days)],
  );
  return { deleted: rowCount };
}

module.exports = { probeTargets, probeHost, probeAll, availability, incidents, purge };
