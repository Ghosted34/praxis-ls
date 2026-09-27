/**
 * Call signals per tenant, kept in Redis (calls audit D4, §4 item 8; PR-5
 * steps 3 and 6). Written where the thing happens, read by the metrics job,
 * so nothing has to scan every tenant's database to know how calls are going.
 *
 *   Day counters   `praxis:callm:<day>:<slug>:<env>:<field>`, incremented at
 *                  each transition (dial, answer, terminal, ack, finalise).
 *                  The day is the call's UTC start day (D11). 8-day TTL.
 *   Latency        hang-up → summary seconds per call, last hour, per tenant.
 *   Backlog        parts waiting per tenant, scored by when they were queued:
 *                  the age of the oldest is the lag the §4 target watches.
 *   Provider 429s  per tenant, provider and hour, beside the request count.
 *
 * Every write is best-effort and never throws: a signal is not worth a call.
 */
"use strict";

const { logger } = require("../../config/logger");
const metrics = require("../../shared/observability/metrics");

const DAY_TTL_S = 8 * 24 * 3600;
const HOUR_MS = 3_600_000;
const k = {
  field: (day, slug, env, f) => `praxis:callm:${day}:${slug}:${env}:${f}`,
  fields: (day, slug, env) => `praxis:callm:${day}:${slug}:${env}:_fields`,
  tenants: (day) => `praxis:callm:${day}:_tenants`,
  latency: (slug, env) => `praxis:calllat:${slug}:${env}`,
  waiting: (slug, env) => `praxis:calltx:waiting:${slug}:${env}`,
  waitingTenants: () => "praxis:calltx:waiting:_tenants",
  hourly: (slug, env, provider, what, hour) => `praxis:calltx:${what}:${slug}:${env}:${provider}:${hour}`,
  signalTenants: () => "praxis:callsig:_tenants",
};

const redis = () => require("../../config/redis").getClient();
const utcDay = (at) => new Date(at || Date.now()).toISOString().slice(0, 10);

function quiet(what) {
  return (err) => logger.debug({ err }, `call signals: ${what} not recorded`);
}
/** Run a signal write; a Redis failure (or no client yet) is logged at debug. */
async function safe(what, fn) {
  try {
    return await fn();
  } catch (err) {
    quiet(what)(err);
    return undefined;
  }
}

/** Add `by` to a day counter for the tenant+env of a call started at `startedAt`. */
async function count({ slug, env = "live", field, by = 1, startedAt = null }) {
  if (!slug || !field || !by) return;
  const day = utcDay(startedAt);
  const member = `${slug}|${env}`;
  await safe(field, () => redis().multi()
    .incrby(k.field(day, slug, env, field), by)
    .expire(k.field(day, slug, env, field), DAY_TTL_S)
    .sadd(k.fields(day, slug, env), field)
    .expire(k.fields(day, slug, env), DAY_TTL_S)
    .sadd(k.tenants(day), member)
    .expire(k.tenants(day), DAY_TTL_S)
    .exec());
}

/** Every counter for a day: `[{ slug, env, fields: { name: n } }]`. */
async function dayCounters(day) {
  const r = redis();
  const members = await r.smembers(k.tenants(day));
  const out = [];
  for (const m of members) {
    const [slug, env] = String(m).split("|");
    const names = await r.smembers(k.fields(day, slug, env));
    const values = names.length ? await r.mget(...names.map((f) => k.field(day, slug, env, f))) : [];
    const fields = {};
    names.forEach((f, i) => { fields[f] = Number(values[i]) || 0; });
    out.push({ slug, env, fields });
  }
  return out;
}

async function remember(slug, env) {
  await redis().sadd(k.signalTenants(), `${slug}|${env}`);
}

/** Hang-up → summary, seconds, for a call's first notified draft. */
async function summaryLatency({ slug, env = "live", callId, seconds, now = Date.now() }) {
  if (!slug || !Number.isFinite(seconds)) return;
  metrics.observe("praxis_call_summary_latency_seconds", seconds, { tenant: slug, env },
    "Hang-up to first summary draft, per tenant.");
  const key = k.latency(slug, env);
  await safe("latency", async () => {
    await redis().multi()
      .zadd(key, now, `${now}:${Math.round(seconds)}:${callId}`)
      .zremrangebyscore(key, "-inf", now - HOUR_MS)
      .expire(key, 2 * 3600)
      .exec();
    await remember(slug, env);
  });
}

/** A part was queued / has left the queue for good. */
async function partQueued({ slug, env = "live", jobId, now = Date.now() }) {
  if (!slug || !jobId) return;
  await safe("queued", () => redis().multi()
    .zadd(k.waiting(slug, env), now, jobId)
    .expire(k.waiting(slug, env), 2 * 86400)
    .sadd(k.waitingTenants(), `${slug}|${env}`)
    .exec());
}

async function partDone({ slug, env = "live", jobId, queuedAt = null, now = Date.now() }) {
  if (!slug || !jobId) return;
  if (queuedAt) {
    metrics.observe("praxis_call_part_wait_seconds", (now - queuedAt) / 1000, { tenant: slug, env },
      "Queue to provider call for a call part, per tenant.");
  }
  await safe("done", () => redis().zrem(k.waiting(slug, env), jobId));
}

/** One provider request for a tenant's part, and whether it was a 429. */
async function providerResult({ slug, env = "live", provider, rateLimited = false, now = Date.now() }) {
  if (!slug || !provider) return;
  const hour = Math.floor(now / HOUR_MS);
  metrics.inc("praxis_call_transcribe_requests_total", { tenant: slug, env, provider, outcome: rateLimited ? "429" : "sent" }, 1,
    "Call-part provider requests per tenant, with 429s.");
  await safe("provider", async () => {
    const m = redis().multi()
      .incr(k.hourly(slug, env, provider, "req", hour))
      .expire(k.hourly(slug, env, provider, "req", hour), 3 * 3600);
    if (rateLimited) {
      m.incr(k.hourly(slug, env, provider, "429", hour)).expire(k.hourly(slug, env, provider, "429", hour), 3 * 3600);
    }
    await m.exec();
    await remember(slug, env);
  });
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

/**
 * The per-tenant signals the alarm reads: p50/p95 hang-up→summary over the
 * last hour, the oldest waiting part's age and the 429 rate this hour.
 */
async function tenantSignals({ now = Date.now() } = {}) {
  const r = redis();
  const members = new Set([
    ...(await r.smembers(k.signalTenants())),
    ...(await r.smembers(k.waitingTenants())),
  ]);
  const hour = Math.floor(now / HOUR_MS);
  const out = [];
  for (const m of members) {
    const [slug, env] = String(m).split("|");
    const lat = (await r.zrangebyscore(k.latency(slug, env), now - HOUR_MS, "+inf"))
      .map((x) => Number(String(x).split(":")[1]))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const oldest = await r.zrange(k.waiting(slug, env), 0, 0, "WITHSCORES");
    const oldestAgeS = oldest.length ? Math.max(0, Math.round((now - Number(oldest[1])) / 1000)) : 0;
    const rates = {};
    for (const provider of ["groq", "gemini"]) {
      const [req, tooMany] = await r.mget(
        k.hourly(slug, env, provider, "req", hour), k.hourly(slug, env, provider, "429", hour),
      );
      rates[provider] = { requests: Number(req) || 0, rate_limited: Number(tooMany) || 0 };
    }
    out.push({
      tenant: slug,
      env,
      summaries: lat.length,
      p50_s: percentile(lat, 50),
      p95_s: percentile(lat, 95),
      oldest_waiting_s: oldestAgeS,
      providers: rates,
    });
    for (const [provider, v] of Object.entries(rates)) {
      metrics.setGauge("praxis_call_transcribe_429_ratio", { tenant: slug, env, provider },
        v.requests ? v.rate_limited / v.requests : 0, "This hour's 429 share of call-part provider requests.");
    }
    metrics.setGauge("praxis_call_oldest_waiting_part_seconds", { tenant: slug, env }, oldestAgeS,
      "Age of the oldest call part waiting to be transcribed, per tenant.");
  }
  return out;
}

module.exports = {
  keys: k,
  utcDay,
  count,
  dayCounters,
  summaryLatency,
  partQueued,
  partDone,
  providerResult,
  tenantSignals,
  percentile,
};
