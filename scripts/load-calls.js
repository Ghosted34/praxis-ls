#!/usr/bin/env node
/**
 * scripts/load-calls.js — calls at scale (doc/SMART_COMMS_CALLS_AUDIT.md,
 * PR-5 acceptance).
 *
 * Simulates 10, 50 and 200 tenants against LOCAL Postgres and Redis and
 * reports, per case:
 *   - ring timeouts: how late each unanswered ring ended after its 60 s
 *     (acceptance: within 5 s for every tenant), while one tenant has 2,000
 *     transcriptions queued and dials a burst of 30 rings at once;
 *   - ring-push latency per tenant: from the moment a push job is due to the
 *     push being handed to the push service (first alerts, re-alerts and
 *     cancels);
 *   - hang-up → summary, p50/p95 (acceptance: p95 under 2 minutes at 10);
 *   - `GET /calls/ringing` in a reconnect storm (every tab at once) and in
 *     steady state: latency and database connections;
 *   - tenant pool use: the most connections any one tenant held at once
 *     (budget: TENANT_POOL_MAX per tenant per process).
 *
 * WHAT IS REAL: BullMQ queues and workers with the product's handlers
 * (comms-call-clock, comms-call-ring-escalate, call-transcribe-part,
 * call-finalise), the call and pipeline services, their SQL, the Redis
 * presence / gate / signal code, and the ringing read. WHAT IS STUBBED: the
 * push service (100–200 ms), object storage, Groq (1.5–3 s), Gemini (2–4 s),
 * the summary LLM (2–4 s) and the notification fan-out. Provider limiters use
 * the configured limits (override with --groq-rpm / --gemini-rpm).
 *
 * THE TENANTS: every simulated tenant is its own slug (so every Redis key,
 * fair share and ranking treats it as a tenant) over ONE disposable copy of a
 * provisioned tenant database. One physical pool (--pool, default 40) serves
 * them all, so each slug gets its own emulated pool in front of it:
 * TENANT_POOL_MAX connections, and the acquire timeout, exactly as a real
 * tenant pool behaves. "Within budget" is then what it means in production:
 * no request or job timed out waiting for its tenant's connection, and the
 * waits it did see.
 *
 * Usage (from the repo root, with the usual DB_* / TENANT_DB_* / REDIS_URL):
 *   node scripts/load-calls.js --slug=citenant
 *   node scripts/load-calls.js --slug=citenant --tenants=10 --minutes=3
 *   node scripts/load-calls.js --slug=citenant --tenants=10,50,200 --json=out.json
 *   node scripts/load-calls.js --slug=citenant --tenants=200 --replicas=4 --groq-rpm=400 --gemini-rpm=600
 *
 * --replicas=N starts N copies of the worker set, as N worker processes would
 * (§4 item 5: scale transcription workers by queue lag). They share this
 * process's per-tenant connection slots, which is stricter than N processes.
 *
 * It creates `tenant_calls_load` from the tenant's database as a template,
 * uses Redis database 15 (--redis-db) and flushes it, and drops both
 * afterwards. Never point it at production.
 */
"use strict";

const path = require("path");

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const SLUG = opt("slug", "citenant");
const CASES = opt("tenants", "10,50,200").split(",").map(Number).filter(Boolean);
const MINUTES = Number(opt("minutes", "3"));
const BACKLOG = Number(opt("backlog", "2000"));
const POOL = Number(opt("pool", "40"));
const REDIS_DB = Number(opt("redis-db", "15"));
const CLONE = opt("clone", "tenant_calls_load");
const JSON_OUT = opt("json", "");
const TABS = Number(opt("tabs", "12"));
const CALLS_PER_MIN = Number(opt("calls-per-min", "1"));
const BURST = Number(opt("burst", "30"));
const REPLICAS = Number(opt("replicas", "1"));

// Configuration before anything reads it.
process.env.LOG_LEVEL = opt("log-level", "error");
if (opt("groq-rpm")) process.env.GROQ_TRANSCRIBE_RPM = opt("groq-rpm");
if (opt("gemini-rpm")) process.env.GEMINI_TRANSCRIBE_RPM = opt("gemini-rpm");
{
  const base = (process.env.REDIS_URL || "redis://127.0.0.1:6379").replace(/\/\d+$/, "");
  process.env.REDIS_URL = `${base}/${REDIS_DB}`;
}

const root = path.join(__dirname, "..");
const req = (p) => require(path.join(root, p));

const { Pool } = require("pg");
const { Worker } = require("bullmq");
const { config } = req("src/config/env");
const redisCfg = req("src/config/redis");
const requestContext = req("src/config/request-context");
const registry = req("src/services/tenant/registry.service");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (lo, hi) => lo + Math.random() * (hi - lo);
const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const say = (text) => process.stdout.write(`${text}\n`);
const round = (x, d = 0) => (x === null || x === undefined ? null : Number(x.toFixed(d)));

/* ── Stubs: the third parties only ─────────────────────────────────────── */
const events = [];
function stubThirdParties() {
  req("src/shared/push/push.service").sendToUser = async (_c, msg) => {
    await sleep(jitter(100, 200));
    events.push({ kind: "push", at: Date.now(), data: msg.data || {} });
    return { sent: 1, failed: 0, total: 1 };
  };
  const storage = req("src/services/storage.service");
  storage.get = async () => Buffer.from("OggS-load-test-audio");
  storage.put = async () => {};
  storage.delete = async () => {};
  req("src/services/ai/transcription.service").transcribe = async () => {
    await sleep(jitter(1500, 3000));
    return { text: "load test words", detected_language: "english", audio_seconds: 120, provider: "groq" };
  };
  req("src/services/ai/gemini-transcription.service").transcribe = async () => {
    await sleep(jitter(2000, 4000));
    return { text: "load test words", detected_language: "en", audio_seconds: 120, provider: "gemini" };
  };
  req("src/services/ai/llm.service").chat = async () => {
    await sleep(jitter(2000, 4000));
    return { provider: "gemini", text: JSON.stringify({ summary: "A load-test call.", key_points: [], follow_ups: [] }) };
  };
  req("src/services/platform/ai-vendor.service").getConfig = async () => null;
  req("src/modules/notification/notification.service").notifyMany = async () => 1;
  req("src/modules/ai/governance/governance.service").canUseFeature = async () => ({ allowed: true });
  req("src/services/platform/alert-routing.service").raise = async () => ({ delivered: false, reason: "load test" });
  const realtime = req("src/realtime");
  realtime.publishToUser = (slug, env, userId, event, payload) => {
    events.push({ kind: "rt", at: Date.now(), slug, event, payload });
  };
}

/* ── One emulated pool per simulated tenant ────────────────────────────── */
const held = new Map(); // slug → { now, max, waiters, waits: [], timeouts }
function instrumentPools() {
  const orig = registry.withTenantConnection;
  const cap = Number(config.TENANT_POOL_MAX) || 4;
  const timeoutMs = Number(config.TENANT_POOL_ACQUIRE_TIMEOUT_MS || 5000);
  registry.withTenantConnection = async (meta, env, fn) => {
    const h = held.get(meta.slug) || { now: 0, max: 0, waiters: [], waits: [], timeouts: 0 };
    held.set(meta.slug, h);
    const asked = Date.now();
    if (h.now >= cap) {
      await new Promise((resolve, reject) => {
        const w = { resolve, timer: null };
        w.timer = setTimeout(() => {
          h.waiters.splice(h.waiters.indexOf(w), 1);
          h.timeouts += 1;
          reject(new Error("timeout exceeded when trying to connect (emulated tenant pool)"));
        }, timeoutMs);
        h.waiters.push(w);
      });
    } else {
      h.now += 1;
    }
    h.waits.push(Date.now() - asked);
    h.max = Math.max(h.max, h.now);
    try {
      return await orig(meta, env, fn);
    } finally {
      const next = h.waiters.shift();
      if (next) { clearTimeout(next.timer); next.resolve(); } else h.now -= 1;
    }
  };
}

/* ── The disposable database ───────────────────────────────────────────── */
function adminPool(database) {
  return new Pool({
    host: config.TENANT_DB_HOST_DEFAULT || config.DB_HOST,
    port: Number(config.TENANT_DB_PORT_DEFAULT || config.DB_PORT),
    user: config.TENANT_DB_SUPERUSER || config.DB_USER,
    password: config.TENANT_DB_SUPERUSER_PASSWORD || config.DB_PASSWORD,
    database,
    max: 4,
  });
}

async function cloneDatabase(template) {
  const admin = adminPool("postgres");
  await admin.query(`DROP DATABASE IF EXISTS ${CLONE} WITH (FORCE)`);
  await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [template]);
  await admin.query(`CREATE DATABASE ${CLONE} TEMPLATE ${template}`);
  await admin.end();
}

async function dropDatabase() {
  const admin = adminPool("postgres");
  await admin.query(`DROP DATABASE IF EXISTS ${CLONE} WITH (FORCE)`);
  await admin.end();
}

/** Users and DIRECT channels for every simulated tenant: 3 pairs each, and
 *  BURST more for the first (heavy) tenant. */
async function fixtures(db, metas) {
  const out = new Map();
  const c = await db.connect();
  try {
    await c.query("SET search_path = live, public");
    await c.query("UPDATE feature_state SET state = 'on' WHERE feature_key IN ('calls','call_recording')");
    for (const [idx, meta] of metas.entries()) {
      const pairs = [];
      for (let p = 0; p < (idx === 0 ? 3 + BURST : 3); p += 1) {
        const { rows } = await c.query(
          `INSERT INTO app_user (email, full_name, password_hash, status)
           VALUES ($1, $2, 'x', 'ACTIVE'), ($3, $4, 'x', 'ACTIVE') RETURNING user_id`,
          [`${meta.slug}-a${p}@load.test`, `${meta.slug} A${p}`, `${meta.slug}-b${p}@load.test`, `${meta.slug} B${p}`],
        );
        const [a, b] = rows.map((r) => r.user_id);
        const g = (await c.query("INSERT INTO comms_group (kind, name) VALUES ('DIRECT', $1) RETURNING group_id", [`${meta.slug}-${p}`])).rows[0].group_id;
        await c.query("INSERT INTO comms_member (group_id, user_id) VALUES ($1, $2), ($1, $3)", [g, a, b]);
        pairs.push({ a, b, g });
      }
      out.set(meta.slug, pairs);
    }
  } finally {
    c.release();
  }
  return out;
}

/** An ended call whose last part per side is still to transcribe (§4.1:
 *  earlier parts were transcribed during the call). */
async function endedCall(db, pair, { declared = 2, endedAgoMs = 0 } = {}) {
  const c = await db.connect();
  try {
    await c.query("SET search_path = live, public");
    const { rows } = await c.query(
      `INSERT INTO comms_call (group_id, caller_id, callee_id, status, started_at, connected_at, ended_at,
                              duration_seconds, end_reason, caller_parts_declared, callee_parts_declared,
                              caller_completed_at, callee_completed_at, transcription_state)
       VALUES ($1, $2, $3, 'ENDED', now() - interval '5 minutes', now() - interval '4 minutes',
               now() - make_interval(secs => $5::float / 1000), 240, 'hangup', $4, $4, now(), now(), 'PENDING')
       RETURNING call_id, ended_at`,
      [pair.g, pair.a, pair.b, declared, endedAgoMs],
    );
    const call = rows[0];
    const parts = [];
    for (const side of ["caller", "callee"]) {
      for (let i = 1; i <= declared; i += 1) {
        const done = i < declared;
        await c.query(
          `INSERT INTO comms_call_recording (call_id, side, part_index, part_count, vault_ref, media_type, size_bytes,
                                            duration_seconds, transcript_status, provider, detected_language, transcribed_at)
           VALUES ($1, $2, $3, $4, $5, 'audio/ogg', 480000, 120, $6, $7, $8, $9)`,
          [call.call_id, side, i, declared, `load/${call.call_id}/${side}_${i}.ogg`,
            done ? "OK" : "PENDING", done ? "groq" : null, done ? "en" : null, done ? new Date() : null],
        );
        if (done) {
          await c.query(
            `INSERT INTO comms_call_transcript (call_id, side, part_index, text, language, provider, certified)
             VALUES ($1, $2, $3, 'earlier words', 'en', 'groq', true)`,
            [call.call_id, side, i],
          );
        } else {
          parts.push({ side, partIndex: i });
        }
      }
    }
    return { callId: call.call_id, endedAt: new Date(call.ended_at).getTime(), parts };
  } finally {
    c.release();
  }
}

/* ── Workers ───────────────────────────────────────────────────────────── */
const ringLatency = []; // { slug, kind, ms }
function startWorkers() {
  const run = (handler, wrap) => async (job, token) => {
    const meta = job.data && job.data.tenantMeta;
    return requestContext.run(
      { tenant: meta && meta.slug, env: (job.data && job.data.env) || "live" },
      () => (wrap ? wrap(job, token) : handler(job, token)),
    );
  };
  const ring = req("src/jobs/handlers/comms-call-ring-escalate");
  const defs = [
    ["comms-call-clock", config.COMMS_CALL_CLOCK_CONCURRENCY, req("src/jobs/handlers/comms-call-clock")],
    ["comms-call-ring-escalate", config.COMMS_CALL_RING_CONCURRENCY, ring, async (job, token) => {
      const due = job.timestamp + ((job.opts && job.opts.delay) || 0);
      const out = await ring(job, token);
      if (out && out.pushed) {
        const kind = job.name === "cancel" ? "cancel" : Number(job.data.alert) > 0 ? "realert" : "first";
        ringLatency.push({ slug: job.data.tenantMeta.slug, kind, ms: Date.now() - due });
      }
      return out;
    }],
    ["call-transcribe-part", config.CALL_TRANSCRIBE_CONCURRENCY, req("src/jobs/handlers/call-transcribe-part")],
    ["call-finalise", config.CALL_FINALISE_CONCURRENCY, req("src/jobs/handlers/call-finalise")],
  ];
  const out = [];
  for (let r = 0; r < REPLICAS; r += 1) {
    for (const [name, concurrency, handler, wrap] of defs) {
      out.push(new Worker(name, run(handler, wrap), {
        connection: redisCfg.createConnection(`load:${name}:${r}`),
        concurrency,
      }));
    }
  }
  return out;
}

/* ── One case ──────────────────────────────────────────────────────────── */
async function runCase(n, baseMeta, db) {
  const redis = redisCfg.getClient();
  await redis.flushdb();
  events.length = 0;
  ringLatency.length = 0;
  held.clear();
  req("src/modules/smartcomm/smartcomm.call.gate").resetLocalForTests();

  const metas = Array.from({ length: n }, (_, i) => ({
    ...baseMeta, slug: `load${String(i).padStart(3, "0")}`, db_name: CLONE, pool_max: POOL,
  }));
  process.stdout.write(`\n== ${n} tenants: fixtures… `);
  const pairs = await fixtures(db, metas);
  const heavy = metas[0];
  const callService = req("src/modules/smartcomm/smartcomm.call.service");
  const pipeline = req("src/modules/smartcomm/smartcomm.call.pipeline.service");

  // The heavy tenant: 2,000 parts queued before anything else happens.
  process.stdout.write(`backlog of ${BACKLOG} parts at ${heavy.slug}… `);
  const hp = pairs.get(heavy.slug)[0];
  for (let i = 0; i < BACKLOG / 2; i += 1) {
    const call = await endedCall(db, hp, { declared: 1, endedAgoMs: 3_600_000 });
    for (const p of call.parts) {
      await pipeline.startPartJob({ callId: call.callId, side: p.side, partIndex: p.partIndex, tenantMeta: heavy, env: "live", origin: "upload" });
    }
  }
  process.stdout.write("running.\n");

  const workers = startWorkers();
  const t0 = Date.now();
  const durationMs = MINUTES * 60_000;
  const tasks = [];

  // Rings: every tenant dials each of its 3 pairs once in the first 20 s;
  // nobody answers, so every ring must end by its own 60 s clock. The heavy
  // tenant also dials a burst of BURST rings at once, at +10 s.
  const rings = [];
  for (const meta of metas) {
    for (const [pi, pair] of pairs.get(meta.slug).entries()) {
      const burst = meta === metas[0] && pi >= 3;
      tasks.push((async () => {
        await sleep(burst ? 10_000 : jitter(0, 20_000));
        const out = await requestContext.run({ tenant: meta.slug, env: "live", userId: pair.a }, () =>
          registry.withTenantConnection(meta, "live", (c) =>
            callService.createCall(c, { groupId: pair.g, actor: { user_id: pair.a }, tenantMeta: meta, env: "live" })));
        rings.push({ slug: meta.slug, callId: out.call_id, startedAt: new Date(out.started_at).getTime(), caller: pair.a });
      })().catch((err) => console.error("dial failed", err.message)));
    }
  }

  // Hang-ups with a summary to write: each tenant but the heavy one ends
  // CALLS_PER_MIN calls a minute for the first (MINUTES - 1) minutes.
  const ended = [];
  const endWindow = Math.max(60_000, durationMs - 60_000);
  for (const meta of metas.slice(1)) {
    const count = Math.max(1, Math.round((CALLS_PER_MIN * endWindow) / 60_000));
    for (let k = 0; k < count; k += 1) {
      tasks.push((async () => {
        await sleep(jitter(0, endWindow));
        const pair = pairs.get(meta.slug)[1 + (k % 2)];
        const call = await endedCall(db, pair, { declared: 2 });
        ended.push({ slug: meta.slug, callId: call.callId, endedAt: call.endedAt });
        for (const p of call.parts) {
          await pipeline.startPartJob({ callId: call.callId, side: p.side, partIndex: p.partIndex, tenantMeta: meta, env: "live", origin: "upload" });
        }
      })().catch((err) => console.error("hang-up failed", err.message)));
    }
  }

  // The ringing read: a reconnect storm at +30 s (every tab once, within 5 s),
  // then each tab once a minute (focus / foreground / online).
  const reads = { storm: [], steady: [] };
  const readOnce = async (meta, userId, bucket) => {
    const s = Date.now();
    await requestContext.run({ tenant: meta.slug, env: "live", userId }, () =>
      registry.withTenantConnection(meta, "live", (c) => callService.listRinging(c, { user_id: userId })));
    reads[bucket].push(Date.now() - s);
  };
  for (const meta of metas) {
    const users = pairs.get(meta.slug).slice(0, 3).flatMap((p) => [p.a, p.b]);
    for (let t = 0; t < TABS; t += 1) {
      const uid = users[t % users.length];
      tasks.push((async () => {
        await sleep(30_000 + jitter(0, 5_000));
        await readOnce(meta, uid, "storm");
        const until = t0 + durationMs;
        while (Date.now() + 60_000 < until) {
          await sleep(jitter(50_000, 70_000));
          await readOnce(meta, uid, "steady");
        }
      })().catch((err) => console.error("ringing read failed", err.message)));
    }
  }

  await Promise.all(tasks);
  // Let the last rings time out and the last summaries land.
  const deadline = t0 + durationMs + 90_000;
  const signals = req("src/modules/smartcomm/smartcomm.call.signals");
  while (Date.now() < deadline) {
    const notified = new Set(events.filter((e) => e.event === "call:no_answer").map((e) => e.payload.call_id));
    const lat = await redis.zcard(`praxis:calllat:${metas[metas.length - 1].slug}:live`);
    if (rings.every((r) => notified.has(r.callId)) && Date.now() > t0 + durationMs && lat >= 0) break;
    await sleep(1000);
  }
  await Promise.all(workers.map((w) => w.close()));

  // ── Results ──
  const noAnswer = new Map();
  for (const e of events) {
    if (e.event === "call:no_answer" && !noAnswer.has(e.payload.call_id)) noAnswer.set(e.payload.call_id, e.at);
  }
  const lateness = rings.map((r) => ({ slug: r.slug, s: noAnswer.has(r.callId) ? (noAnswer.get(r.callId) - (r.startedAt + 60_000)) / 1000 : null }));
  const missed = lateness.filter((x) => x.s === null).length;
  const late = lateness.filter((x) => x.s !== null).map((x) => x.s);

  const perTenantRing = new Map();
  for (const r of ringLatency) {
    if (!perTenantRing.has(r.slug)) perTenantRing.set(r.slug, []);
    perTenantRing.get(r.slug).push(r);
  }
  const worstTenantP95 = (kind, skipHeavy = false) => Math.max(0, ...[...perTenantRing.entries()]
    .filter(([slug]) => !skipHeavy || slug !== heavy.slug)
    .map(([, xs]) => pct(xs.filter((x) => x.kind === kind).map((x) => x.ms), 95))
    .filter((x) => x !== null));
  const all = (kind) => ringLatency.filter((x) => x.kind === kind).map((x) => x.ms);

  const tenantSignals = await signals.tenantSignals();
  const summaryLat = [];
  for (const s of tenantSignals) {
    if (s.tenant === heavy.slug) continue;
    const xs = (await redis.zrangebyscore(`praxis:calllat:${s.tenant}:live`, "-inf", "+inf"))
      .map((x) => Number(String(x).split(":")[1]));
    summaryLat.push(...xs);
  }
  const heavySig = tenantSignals.find((s) => s.tenant === heavy.slug) || {};
  const waitsOf = (pred) => [...held.entries()].filter(([slug]) => pred(slug)).flatMap(([, h]) => h.waits);
  const otherWaits = waitsOf((slug) => slug !== heavy.slug);
  const heavyWaits = waitsOf((slug) => slug === heavy.slug);
  const timeouts = [...held.values()].reduce((s, h) => s + h.timeouts, 0);
  const result = {
    tenants: n,
    minutes: MINUTES,
    backlog_parts: BACKLOG,
    ring_timeouts: {
      rings: rings.length,
      ended: rings.length - missed,
      late_s: { p50: round(pct(late, 50), 2), p95: round(pct(late, 95), 2), max: round(Math.max(...late), 2) },
      all_within_5s: missed === 0 && late.every((s) => s <= 5),
    },
    ring_push_latency_ms: {
      first: {
        p50: pct(all("first"), 50),
        p95: pct(all("first"), 95),
        max: Math.max(0, ...all("first")),
        worst_tenant_p95: worstTenantP95("first"),
        worst_other_tenant_p95: worstTenantP95("first", true),
        burst_tenant_p95: pct((perTenantRing.get(heavy.slug) || []).filter((x) => x.kind === "first").map((x) => x.ms), 95),
      },
      realert: { p50: pct(all("realert"), 50), p95: pct(all("realert"), 95), max: Math.max(0, ...all("realert")), worst_tenant_p95: worstTenantP95("realert") },
      cancel: { p50: pct(all("cancel"), 50), p95: pct(all("cancel"), 95), max: Math.max(0, ...all("cancel")), worst_tenant_p95: worstTenantP95("cancel") },
    },
    hangup_to_summary_s: {
      summaries: summaryLat.length,
      calls_ended: ended.length,
      p50: round(pct(summaryLat, 50), 1),
      p95: round(pct(summaryLat, 95), 1),
      max: round(summaryLat.length ? Math.max(...summaryLat) : null, 1),
    },
    heavy_tenant: {
      slug: heavy.slug,
      oldest_waiting_s: heavySig.oldest_waiting_s || null,
      summaries: heavySig.summaries || 0,
    },
    ringing_read_ms: {
      storm: { reads: reads.storm.length, p50: pct(reads.storm, 50), p95: pct(reads.storm, 95), max: Math.max(0, ...reads.storm) },
      steady: { reads: reads.steady.length, p50: pct(reads.steady, 50), p95: pct(reads.steady, 95) },
    },
    pool: {
      budget_per_tenant: Number(config.TENANT_POOL_MAX),
      max_held_any_tenant: Math.max(0, ...[...held.values()].map((h) => h.max)),
      checkouts: [...held.values()].reduce((s, h) => s + h.waits.length, 0),
      acquire_timeouts: timeouts,
      wait_ms_other_tenants: { p95: pct(otherWaits, 95), max: Math.max(0, ...otherWaits) },
      wait_ms_heavy_tenant: { p95: pct(heavyWaits, 95), max: Math.max(0, ...heavyWaits) },
      within_budget: timeouts === 0,
    },
  };
  say(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  await redisCfg.initRedis();
  stubThirdParties();
  instrumentPools();
  const baseMeta = await registry.resolveBySlug(SLUG);
  if (!baseMeta) throw new Error(`tenant ${SLUG} not found in the platform registry`);
  say(`load-calls: cloning ${baseMeta.db_name} → ${CLONE}; Redis db ${REDIS_DB}; ${REPLICAS} worker replica(s); limits groq ${config.GROQ_TRANSCRIBE_RPM} rpm / ${config.GROQ_TRANSCRIBE_AUDIO_SECONDS_PER_HOUR} s·h, gemini ${config.GEMINI_TRANSCRIBE_RPM} rpm; tenant share ${config.CALL_TRANSCRIBE_TENANT_PER_MIN}/min burst ${config.CALL_TRANSCRIBE_TENANT_BURST}`);
  const results = [];
  try {
    for (const n of CASES) {
      await cloneDatabase(baseMeta.db_name);
      const db = adminPool(CLONE);
      try {
        results.push(await runCase(n, baseMeta, db));
      } finally {
        await db.end();
        await registry.closeAll?.();
      }
    }
  } finally {
    await dropDatabase().catch(() => {});
    await redisCfg.getClient().flushdb().catch(() => {});
    await redisCfg.closeRedis();
  }
  if (JSON_OUT) require("fs").writeFileSync(JSON_OUT, JSON.stringify(results, null, 2));
  const ok = results.every((r) => r.ring_timeouts.all_within_5s && r.pool.within_budget)
    && results.filter((r) => r.tenants === 10).every((r) => r.hangup_to_summary_s.p95 !== null && r.hangup_to_summary_s.p95 < 120);
  say(ok ? "\nload-calls: acceptance met" : "\nload-calls: acceptance NOT met");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
