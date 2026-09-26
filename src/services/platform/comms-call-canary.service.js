/**
 * The daily platform call check (calls audit PR-7; owner decision O5).
 *
 * Once a day, platform-wide (one small run, not one per tenant), it proves
 * the pieces every tenant's calls share, and reports ONLY to the platform
 * console — the Health page's "Calls pipeline" section and the console bell.
 * Nothing of it reaches a tenant app.
 *
 *   queue       this job was picked up on time (the queue and a worker)
 *   signals     an API instance is subscribed to the worker's live-signal
 *               channel, so an event the worker emits reaches a screen
 *               (calls audit A6: `call:summary_ready` once reached nobody)
 *   schedules   the daily record sweep is registered at a daytime hour and
 *               no midnight repeatable is left behind
 *   transcribe  one short English clip through Groq, then FORCED through
 *               Gemini (the pipeline's own transcribePart, diagnostics mode)
 *   summary     a Gemini summary, then a FORCED DeepSeek one
 *   relay       a TURN allocation from the server, with a credential signed
 *               the way the API signs a caller's
 *
 * and, per tenant and environment, the checks that spend no provider credit:
 * the database answers; no call is still ringing past its ring window or live
 * past its cap; no transcript has sat in PROCESSING for over an hour.
 *
 * A failure, and the first pass after one, raise ONE bell notification each
 * (`notifications.notifyCapable`) and an `alerts.raise` at severity `notify`.
 * A second failing day in a row stays quiet on the bell: the console already
 * shows it red, and a bell that rings daily for one outage stops meaning
 * anything.
 */
"use strict";

const crypto = require("crypto");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");

const EVENT = "comms.call_canary";
const QUEUE_MAX_MS = 60_000;
const STUCK_PROCESSING = "1 hour";

function db() {
  const platform = require("./db");
  return { query: (t, p) => (platform.opsQuery || platform.query)(t, p) };
}

const errText = (err) => String((err && err.message) || err || "failed").slice(0, 300);

async function timed(key, label, fn) {
  const started = Date.now();
  try {
    const out = (await fn()) || {};
    return { key, label, ok: out.ok !== false, ms: Date.now() - started, error: out.ok === false ? out.error || "failed" : null, detail: out.detail || null };
  } catch (err) {
    return { key, label, ok: false, ms: Date.now() - started, error: errText(err), detail: null };
  }
}

// ── The shared checks ───────────────────────────────────────────────────────

/** The queue delivered this run on time: now − (created + delay). */
function queueCheck(job, now = Date.now()) {
  const due = Number(job && job.timestamp) + Number((job && job.opts && job.opts.delay) || 0);
  if (!Number.isFinite(due) || due <= 0) return { ok: true, detail: { late_ms: null } };
  const late = Math.max(0, now - due);
  return late <= QUEUE_MAX_MS
    ? { ok: true, detail: { late_ms: late } }
    : { ok: false, error: `the job ran ${Math.round(late / 1000)} s after it was due`, detail: { late_ms: late } };
}

/** Someone is listening on the adapter channel the worker's emitter publishes to. */
async function signalCheck(redis) {
  const channel = "socket.io#/#";
  const res = await redis.call("PUBSUB", "NUMSUB", channel);
  const listeners = Number(Array.isArray(res) ? res[1] : 0);
  return listeners > 0
    ? { ok: true, detail: { listeners } }
    : { ok: false, error: "no API instance is subscribed to the realtime channel: events the worker emits reach nobody", detail: { listeners } };
}

async function scheduleCheck(getQueue) {
  const { hourIn } = require("../../modules/smartcomm/smartcomm.diagnostics.service");
  const tz = config.COMMS_CALL_RECORD_SWEEP_TZ || "Africa/Douala";
  const reps = await getQueue("comms-call-record-sweep-scheduler").getRepeatableJobs();
  if (!reps.length) return { ok: false, error: "the daily call-record sweep is not scheduled" };
  if (reps.some((r) => r.every || /^0 0 /.test(String(r.pattern || "")))) {
    return { ok: false, error: "a midnight or interval repeatable is registered for the daily sweep" };
  }
  const next = reps.map((r) => Number(r.next)).filter(Number.isFinite).sort((a, b) => a - b)[0];
  const hour = next ? hourIn(next, tz) : null;
  if (hour !== null && (hour < 7 || hour >= 20)) {
    return { ok: false, error: `the next daily sweep is at ${String(hour).padStart(2, "0")}:00 ${tz}` };
  }
  return { ok: true, detail: { next_local_hour: hour, time_zone: tz } };
}

async function relayCheck() {
  // The RESOLVED config, not env: the relay's host is settable from the
  // console, and a canary that checked env would pass against a relay no call
  // is being sent to (or fail against one that works).
  const relay = await require("./runtime-config.service").turn();
  if (!relay.configured) {
    return { ok: false, error: "no relay configured (host / TURN_CREDENTIAL_SECRET): calls between mobile networks may not connect" };
  }
  const turn = require("../../modules/smartcomm/smartcomm.turn.service");
  // Signed with the secret in force (vault or `.env`), or a deployment that
  // has rotated from the console would fail its own canary.
  const secret = await require("../../modules/smartcomm/smartcomm.turn.secret.service").activeSecret();
  const { label, mac } = turn.signedLabel({
    id: `canary-${crypto.randomBytes(9).toString("base64url")}`, ttlSeconds: 60, secret,
  });
  const out = await require("./turn-probe").allocate({
    host: relay.host, port: relay.portUdp, label, mac,
  });
  return out.ok
    ? { ok: true, detail: { relayed: out.relayed } }
    : { ok: false, error: out.code === 401 ? "the relay refused the credential (401): TURN_CREDENTIAL_SECRET does not match the relay's" : out.error };
}

async function providerChecks() {
  const diag = require("../../modules/smartcomm/smartcomm.diagnostics.service");
  const ref = diag.referenceSet();
  const en = ref.clips.filter((c) => c.language === "en");
  const clips = await diag.checkReferenceClips({ clips: en });
  const sums = await diag.checkSummaries({ transcript: ref.summary });
  const one = (key, label, c) => ({ key, label, ok: !!(c && c.ok), ms: c ? c.ms : null, error: c ? c.error : "not run" });
  return [
    one("groq", "Transcription via Groq", clips.find((c) => c.provider === "groq")),
    one("gemini_transcribe", "Transcription via Gemini (forced)", clips.find((c) => c.provider === "gemini")),
    one("gemini_summary", "Summary via Gemini", sums.find((c) => c.provider === "gemini")),
    one("deepseek_summary", "Summary via DeepSeek (forced)", sums.find((c) => c.provider === "deepseek")),
  ];
}

// ── The per-tenant checks (no provider credit) ──────────────────────────────

async function tenantCheck(client) {
  const problems = [];
  const { rows } = await client.query(
    `SELECT count(*) FILTER (WHERE status = 'RINGING' AND started_at < now() - interval '90 seconds')::int AS ringing,
            count(*) FILTER (WHERE status = 'IN_CALL' AND connected_at < now() - interval '32 minutes')::int AS live,
            count(*) FILTER (WHERE transcription_state = 'PROCESSING'
                              AND transcription_updated_at < now() - interval '${STUCK_PROCESSING}')::int AS processing
       FROM comms_call
      WHERE status IN ('RINGING', 'IN_CALL') OR transcription_state = 'PROCESSING'`,
  );
  const r = rows[0] || {};
  if (r.ringing) problems.push(`${r.ringing} call(s) ringing past the ring window`);
  if (r.live) problems.push(`${r.live} call(s) live past the 30-minute cap`);
  if (r.processing) problems.push(`${r.processing} transcript(s) in PROCESSING for over an hour`);
  return problems;
}

async function tenantChecks({ listTenants, withTenant }) {
  const out = [];
  for (const t of await listTenants()) {
    const envs = t.sandbox_schema ? ["live", "sandbox"] : ["live"];
    for (const env of envs) {
      try {
        const problems = await withTenant(t, env, tenantCheck);
        out.push({ slug: t.slug, env, ok: problems.length === 0, problems });
      } catch (err) {
        out.push({ slug: t.slug, env, ok: false, problems: [`database unreachable: ${errText(err).slice(0, 120)}`] });
      }
    }
  }
  return out.sort((a, b) => Number(a.ok) - Number(b.ok) || a.slug.localeCompare(b.slug));
}

// ── The run ─────────────────────────────────────────────────────────────────

function summarise(status, checks, tenants) {
  const bad = checks.filter((c) => !c.ok);
  const badTenants = tenants.filter((t) => !t.ok);
  if (status === "PASSED") return `All ${checks.length} call checks passed across ${tenants.length} tenant environment(s).`;
  return [
    ...bad.map((c) => `${c.label}: ${c.error}`),
    ...badTenants.slice(0, 10).map((t) => `${t.slug} (${t.env}): ${t.problems.join("; ")}`),
    ...(badTenants.length > 10 ? [`…and ${badTenants.length - 10} more tenant environment(s)`] : []),
  ].join("\n");
}

async function previousStatus(q) {
  const { rows } = await q.query(
    "SELECT status FROM platform.comms_call_canary_run ORDER BY started_at DESC LIMIT 1",
  );
  return rows[0] ? rows[0].status : null;
}

/**
 * Run the check. Every dependency is injectable for the tests; the defaults
 * are the real queue, Redis, registry and platform database.
 */
async function run({
  job = null,
  now = Date.now(),
  platform = db(),
  redis = null,
  getQueue = null,
  providers = providerChecks,
  relay = relayCheck,
  listTenants = null,
  withTenant = null,
  notify = null,
  raise = null,
} = {}) {
  const started = new Date(now);
  const redisClient = redis || require("../../config/redis").getClient();
  const queues = getQueue || require("../../jobs/queue-producer").getQueue;
  const registry = require("../tenant/registry.service");
  const checks = [
    await timed("queue", "Queue and worker", async () => queueCheck(job, now)),
    await timed("signals", "Live-signal emitter", () => signalCheck(redisClient)),
    await timed("schedules", "Scheduler registrations", () => scheduleCheck(queues)),
  ];
  try {
    checks.push(...(await providers()));
  } catch (err) {
    checks.push({ key: "providers", label: "Transcription and summary providers", ok: false, ms: null, error: errText(err) });
  }
  checks.push(await timed("relay", "TURN relay allocation", relay));
  const tenants = await tenantChecks({
    listTenants: listTenants || (() => registry.listActiveTenants()),
    withTenant: withTenant || ((t, env, fn) => registry.withTenantConnection(t, env, fn)),
  });

  const status = checks.every((c) => c.ok) && tenants.every((t) => t.ok) ? "PASSED" : "FAILED";
  const summary = summarise(status, checks, tenants);
  const before = await previousStatus(platform).catch(() => null);
  const { rows } = await platform.query(
    `INSERT INTO platform.comms_call_canary_run (started_at, finished_at, status, checks, tenant_checks, summary)
     VALUES ($1, now(), $2, $3::jsonb, $4::jsonb, $5)
     RETURNING run_id, started_at, finished_at, status`,
    [started.toISOString(), status, JSON.stringify(checks), JSON.stringify(tenants), summary],
  );

  // One bell on a failure that was not already failing, one on the recovery.
  const turned = status === "FAILED" ? before !== "FAILED" : before === "FAILED";
  if (turned) {
    const title = status === "FAILED" ? "Calls pipeline check failed" : "Calls pipeline check recovered";
    const bell = notify || ((n) => require("./notifications.service").notifyCapable(n));
    const alert = raise || ((a) => require("./alert-routing.service").raise(a));
    try {
      await bell({ title, body: summary.slice(0, 1500), metadata: { kind: EVENT, run_id: rows[0].run_id, status } });
    } catch (err) {
      logger.warn({ err }, "call canary: the bell notification failed");
    }
    try {
      await alert({ event: EVENT, severity: "notify", subject: title, detail: summary });
    } catch (err) {
      logger.warn({ err }, "call canary: the alert failed");
    }
  }
  logger.info({ status, failed: checks.filter((c) => !c.ok).map((c) => c.key) }, "call canary finished");
  return { ...rows[0], checks, tenant_checks: tenants, summary, notified: turned };
}

/** The console's read: the latest run in full, and the history's verdicts. */
async function latest({ platform = db(), days = 30 } = {}) {
  const { rows } = await platform.query(
    `SELECT run_id, started_at, finished_at, status, checks, tenant_checks, summary
       FROM platform.comms_call_canary_run
      WHERE started_at >= now() - make_interval(days => $1::int)
      ORDER BY started_at DESC`,
    [days],
  );
  return {
    latest: rows[0] || null,
    history: rows.map((r) => ({
      run_id: r.run_id, started_at: r.started_at, status: r.status,
      failed: (r.checks || []).filter((c) => !c.ok).map((c) => c.label),
    })),
  };
}

module.exports = { run, latest, queueCheck, signalCheck, scheduleCheck, relayCheck, tenantCheck, tenantChecks, summarise, EVENT };
