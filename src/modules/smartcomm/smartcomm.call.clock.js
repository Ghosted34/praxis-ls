/**
 * Per-call clocks (calls audit D1; PR-5 step 1).
 *
 * Each call carries its own deadlines as delayed jobs on `comms-call-clock`:
 *   ring      at dial + 60 s      → NO_ANSWER if it still rings;
 *   cap       at answer + 30 min  → ENDED(max_duration) if still in a call;
 *   liveness  60 s after a participant's last socket leaves mid-call
 *             → ENDED(disconnected) if both are still gone.
 * JobIds are per call, so a retried dial or a second disconnect queues
 * nothing twice. The queue carries only these, so a transcription backlog
 * cannot delay a ring timeout.
 *
 * A 5-minute safety sweep backs them up, visiting only the tenants in
 * `praxis:comms:call-tenants` (a sorted set scored by the last call activity),
 * which is what replaced the 15-second fleet-wide sweep.
 *
 * Nothing here throws into a call: a queue outage leaves the safety sweep.
 */
"use strict";

const { logger } = require("../../config/logger");

const QUEUE = "comms-call-clock";
const ACTIVE_TENANTS_KEY = "praxis:comms:call-tenants";
/** Past the deadline itself, so the row is due by the time the job runs. */
const GRACE_MS = 500;
/** A tenant leaves the active set once it has no live call and no activity
 *  for this long (so a call dialled while the sweep was reading is kept). */
const IDLE_RELEASE_MS = 10 * 60 * 1000;

function redis() {
  return require("../../config/redis").getClient();
}

/** Record that a tenant+env has call activity now. Never throws. */
async function markTenantActive(tenantMeta, env = "live", now = Date.now()) {
  if (!tenantMeta || !tenantMeta.slug) return;
  try {
    await redis().zadd(ACTIVE_TENANTS_KEY, now, `${tenantMeta.slug}|${env}`);
  } catch (err) {
    logger.warn({ err, tenant: tenantMeta.slug }, "call clock: could not mark the tenant active");
  }
}

/** The tenants the safety sweep visits: `[{ slug, env }]`. */
async function activeTenants() {
  const members = await redis().zrange(ACTIVE_TENANTS_KEY, 0, -1);
  return members.map((m) => {
    const [slug, env] = String(m).split("|");
    return { slug, env: env === "sandbox" ? "sandbox" : "live" };
  });
}

/** Drop a tenant with no live call whose last activity is old enough. */
async function releaseIfIdle(slug, env, now = Date.now()) {
  const member = `${slug}|${env}`;
  const r = redis();
  const score = await r.zscore(ACTIVE_TENANTS_KEY, member);
  if (score !== null && Number(score) <= now - IDLE_RELEASE_MS) {
    await r.zrem(ACTIVE_TENANTS_KEY, member);
    return true;
  }
  return false;
}

async function schedule(kind, { callId, tenantMeta, env = "live", delayMs, jobId, extra = {} }) {
  if (!callId || !tenantMeta) return null;
  try {
    const { enqueue } = require("../../jobs/queue-producer");
    return await enqueue("comms-call-clock", kind, { callId, tenantMeta, env, ...extra }, {
      jobId,
      delay: Math.max(0, Math.round(delayMs)),
      attempts: 3,
      backoff: { type: "fixed", delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
  } catch (err) {
    logger.warn({ err, callId, kind }, "call clock: could not queue — the safety sweep remains");
    return null;
  }
}

function scheduleRingDeadline({ callId, tenantMeta, env, ringTimeoutS, startedAt = Date.now() }) {
  const due = new Date(startedAt).getTime() + ringTimeoutS * 1000 + GRACE_MS;
  return schedule("ring", { callId, tenantMeta, env, delayMs: due - Date.now(), jobId: `callclock-ring-${callId}` });
}

function scheduleCap({ callId, tenantMeta, env, maxCallS, connectedAt = Date.now() }) {
  const due = new Date(connectedAt).getTime() + maxCallS * 1000 + GRACE_MS;
  return schedule("cap", { callId, tenantMeta, env, delayMs: due - Date.now(), jobId: `callclock-cap-${callId}` });
}

/** A liveness check at `atMs`. One job per call per due second. */
function scheduleLiveness({ callId, tenantMeta, env, atMs }) {
  const sec = Math.ceil(atMs / 1000);
  return schedule("liveness", {
    callId, tenantMeta, env, delayMs: atMs - Date.now(), jobId: `callclock-live-${callId}-${sec}`,
  });
}

module.exports = {
  QUEUE,
  ACTIVE_TENANTS_KEY,
  GRACE_MS,
  IDLE_RELEASE_MS,
  markTenantActive,
  activeTenants,
  releaseIfIdle,
  scheduleRingDeadline,
  scheduleCap,
  scheduleLiveness,
};
