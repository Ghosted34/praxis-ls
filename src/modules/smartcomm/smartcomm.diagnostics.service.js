/**
 * Test calls — the call pipeline, tested end to end from Comms → Setup
 * (calls audit PR-7; owner decision O5).
 *
 * A run proves every step of a call on the runner's device and on the server,
 * with the REAL code, and names the one step that is broken:
 *
 *    1 worker        a job goes through the real queue and worker (≤ 5 s)
 *    2 schedules     the daily record sweep is at a daytime hour in the
 *                    tenant's time zone; no ring or cap deadline is overdue
 *    3 signals       the worker's live-signal emitter reaches this screen (≤ 5 s)
 *    4 ring          a real ring push reaches this device (device, ≤ 10 s)
 *    5 microphone    permission, device, a voice level (device)
 *    6 audio         remote audio would play; the noise filter loads (device)
 *    7 connection    STUN, a TURN credential, a relayed loopback call (device)
 *    8 recording     3 short parts, each a complete container (server check)
 *    9 transcription reference clips through Groq, then FORCED through
 *                    Gemini; the runner's parts in the production order (O1)
 *   10 summary       Gemini, then DeepSeek FORCED (O2); schema, language,
 *                    key points quoted from the transcript
 *   11 cleanup       the run's audio objects deleted
 *
 * REAL CODE, SEPARATE RECORDS. The providers are driven through the
 * pipeline's own `transcribePart` and `draftSummary` in their diagnostics
 * mode; the push through the call service's `testRing`; the relay credential
 * through the TURN service. Results are written to the run row
 * (`comms_call_diagnostic_run`) and nowhere else: no call row, no part, no
 * transcript, no call metric or signal, no chat, no notification. Usage is
 * recorded under the `diagnostics` feature line.
 *
 * A step that cannot run because an earlier one failed is SKIPPED, not red,
 * so a stopped worker turns step 1 red (and step 3, which IS the worker's
 * emitter, skipped) rather than painting the whole screen.
 *
 * CAP. 3 runs per tenant per day, in the tenant's time zone, counted in the
 * run table under an advisory lock, so two simultaneous starts cannot both be
 * the third. Runs are kept 90 days.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { callSummary } = require("@praxis/shared");
const repo = require("./smartcomm.diagnostics.repo");
const pipeline = require("./smartcomm.call.pipeline.service");
const storage = require("../../services/storage.service");
const governance = require("../ai/governance/governance.service");
const realtime = require("../../realtime");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");

const DAILY_CAP = 3;
const RETENTION_DAYS = 90;
const WORKER_MAX_MS = 5000;
const SIGNAL_MAX_MS = 5000;
/** How long a server step may stay pending before the read calls it failed. */
const WORKER_WATCHDOG_MS = 15000;
const SIGNAL_WATCHDOG_MS = 15000;
const PIPELINE_WATCHDOG_MS = 4 * 60 * 1000;
const MATCH_MIN = 0.85;
const PARTS = 3;
const QUEUE = "comms-diagnostics";
const EVENT = "comms:diagnostics";
const FEATURE = "diagnostics";

const STEPS = Object.freeze([
  { key: "worker", n: 1, title: "Server and worker", by: "server" },
  { key: "schedules", n: 2, title: "Schedules", by: "server" },
  { key: "signals", n: 3, title: "Live signals", by: "server" },
  { key: "ring", n: 4, title: "Ring to this device", by: "device" },
  { key: "microphone", n: 5, title: "Microphone", by: "device" },
  { key: "audio", n: 6, title: "Audio", by: "device" },
  { key: "connection", n: 7, title: "Connection", by: "device" },
  { key: "recording", n: 8, title: "Recording", by: "device" },
  { key: "transcription", n: 9, title: "Transcription", by: "server" },
  { key: "summary", n: 10, title: "Summary", by: "server" },
  { key: "cleanup", n: 11, title: "Clean-up", by: "server" },
]);
/** The steps the runner's device reports (recording only as a failure: its
 *  success is the server's container check on the uploaded parts). */
const DEVICE_KEYS = new Set(["ring", "microphone", "audio", "connection", "recording"]);
const TERMINAL = new Set(["pass", "warn", "fail", "skipped"]);
const PIPELINE_KEYS = ["transcription", "summary", "cleanup"];

const FIXTURES = path.join(__dirname, "diagnostics-fixtures");
let reference = null;
/** The bundled reference clips and summary transcript (loaded once). */
function referenceSet() {
  if (!reference) {
    const meta = JSON.parse(fs.readFileSync(path.join(FIXTURES, "reference.json"), "utf8"));
    reference = {
      clips: meta.clips.map((c) => ({ ...c, audio: fs.readFileSync(path.join(FIXTURES, c.file)) })),
      summary: meta.summary_transcript,
    };
  }
  return reference;
}

// ── Pure helpers (the contract, tested directly) ─────────────────────────────

function blankSteps() {
  return STEPS.map((s) => ({ key: s.key, n: s.n, title: s.title, status: "pending" }));
}

/** Words, lower-cased, accents kept (French words differ by them), no punctuation. */
function words(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/'/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** 1 − word error rate against the expected text, floored at 0. */
function wordMatch(expected, got) {
  const a = words(expected);
  const b = words(got);
  if (!a.length) return b.length ? 0 : 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return Math.max(0, 1 - prev[b.length] / a.length);
}

const STOP = {
  en: new Set(["the", "and", "is", "to", "of", "a", "in", "that", "it", "for", "on", "with", "will", "be", "at", "by", "this", "was", "you", "have"]),
  fr: new Set(["le", "la", "les", "et", "est", "de", "des", "du", "un", "une", "à", "au", "en", "pour", "que", "qui", "dans", "sur", "avec", "il"]),
};
/** "en", "fr" or null when the text does not say. Enough to catch a summary
 *  drafted in the wrong language; not a language detector. */
function guessLanguage(text) {
  const w = words(text);
  const en = w.filter((x) => STOP.en.has(x)).length;
  const fr = w.filter((x) => STOP.fr.has(x)).length;
  if (en + fr < 3 || en === fr) return null;
  return en > fr ? "en" : "fr";
}

/** A key point is quoted when ≥ 85% of its words occur in the transcript. */
function quotedFrom(point, transcript) {
  const have = new Set(words(transcript));
  const w = words(point);
  if (!w.length) return false;
  return w.filter((x) => have.has(x)).length / w.length >= MATCH_MIN;
}

/** A run's verdict from its steps; null while any is still open. */
function finalStatus(steps) {
  if (steps.some((s) => !TERMINAL.has(s.status))) return null;
  if (steps.some((s) => s.status === "fail")) return "FAILED";
  if (steps.some((s) => s.status === "warn" || s.status === "skipped")) return "WARN";
  return "PASSED";
}

/** The step-list with one step replaced. */
function withStep(steps, key, patch) {
  return steps.map((s) => (s.key === key ? { ...s, ...patch, key: s.key, n: s.n, title: s.title, at: new Date().toISOString() } : s));
}

/** Provider error text is capped and never carries a key (they are headers,
 *  but a vendor that echoes a request would put one in its body). */
function clean(text, max = 300) {
  return String(text || "")
    .replace(/\bbearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b(api[_-]?key|key|token|secret|authorization)\s*[=:]\s*(?!Bearer \[redacted\])[^\s,;]+/gi, "$1=[redacted]")
    // Vendor key shapes, wherever they appear: Groq, OpenAI-style, Google.
    .replace(/\b(gsk|sk|AIza)[-_A-Za-z0-9]{8,}/g, "[redacted]")
    .slice(0, max);
}

function serverVersion() {
  try {
    return require("../../../package.json").version;
  } catch {
    /* @silent:parse — the report says "unknown" rather than failing the run. */
    return "unknown";
  }
}

/** The plain-text "Copy report": what support needs, never audio or a secret. */
function buildReport(run) {
  const lines = [
    "Praxis LS — Test calls report",
    `Run: ${run.run_id}`,
    `Environment: ${run.env}`,
    `Started (UTC): ${new Date(run.started_at).toISOString()}`,
    `Finished (UTC): ${run.finished_at ? new Date(run.finished_at).toISOString() : "—"}`,
    `Server: ${serverVersion()} · Node ${process.version}`,
    `App: ${run.app_version || "unknown"}`,
    `Browser: ${clean(run.user_agent || "unknown", 200)}`,
    `Result: ${run.status}`,
    "",
  ];
  for (const s of run.steps) {
    const ms = Number.isFinite(s.ms) ? ` · ${Math.round(s.ms)} ms` : "";
    lines.push(`${String(s.n).padStart(2, " ")}. ${s.title} — ${String(s.status).toUpperCase()}${ms}`);
    if (s.code) lines.push(`    code: ${s.code}`);
    if (s.cause) lines.push(`    cause: ${clean(s.cause)}`);
    if (s.fix) lines.push(`    fix: ${clean(s.fix)}`);
    if (Array.isArray(s.detail && s.detail.checks)) {
      for (const c of s.detail.checks) {
        const t = Number.isFinite(c.ms) ? ` ${Math.round(c.ms)} ms` : "";
        const m = Number.isFinite(c.match) ? ` match ${Math.round(c.match * 100)}%` : "";
        lines.push(`    - ${c.label}: ${c.ok ? "ok" : "failed"}${t}${m}${c.error ? ` (${clean(c.error, 160)})` : ""}`);
      }
    }
  }
  return lines.join("\n");
}

// ── The run's state ──────────────────────────────────────────────────────────

function emit(meta, run, step) {
  if (!meta || !meta.slug) return;
  try {
    realtime.publishToUser(meta.slug, meta.env || "live", run.user_id, EVENT, {
      run_id: run.run_id, status: run.status, step: step || null,
    });
  } catch (err) {
    logger.warn({ err, run_id: run.run_id }, "diagnostics: progress emit failed (the screen polls)");
  }
}

/** Close the run when every step is terminal: status, finish time, report. */
function settle(run) {
  const status = finalStatus(run.steps);
  if (!status || run.status !== "RUNNING") return run;
  const done = { ...run, status, finished_at: new Date().toISOString() };
  return { ...done, report: buildReport(done) };
}

/**
 * Apply `mutate(run)` to the locked row and save it. Every step write goes
 * through here, so two writers (the job and the runner's device) never lose
 * each other's step.
 */
async function update(liveClient, runId, mutate, meta = null) {
  const saved = await atomically(liveClient, async () => {
    const run = await repo.getRun(liveClient, runId, { lock: true });
    if (!run) throw new AppError("NOT_FOUND", "Test run not found", 404);
    const next = settle(await mutate(run));
    if (next === run) return run;
    return repo.saveRun(liveClient, next);
  });
  if (meta) emit(meta, saved);
  return saved;
}

const setStep = (liveClient, runId, key, patch, meta) =>
  update(liveClient, runId, (run) => ({ ...run, steps: withStep(run.steps, key, patch) }), meta);

function stepOf(run, key) {
  return run.steps.find((s) => s.key === key) || null;
}

function ownRun(run, actor) {
  if (!run || run.user_id !== actor.user_id) throw new AppError("NOT_FOUND", "Test run not found", 404);
  if (run.status !== "RUNNING") throw new AppError("DIAGNOSTICS_RUN_CLOSED", "This test run has finished", 409);
  return run;
}

// ── Step 2: schedules (no worker needed) ─────────────────────────────────────

/** The hour (0–23) of `ms` in `timeZone`. */
function hourIn(ms, timeZone) {
  // @date-format:parts — formatToParts only; nothing here is shown to anyone.
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false }).formatToParts(new Date(ms));
  return Number((parts.find((p) => p.type === "hour") || {}).value) % 24;
}

async function checkSchedules({ envClient, timeZone, slug, queues = null }) {
  const started = Date.now();
  const getQueue = queues || require("../../jobs/queue-producer").getQueue;
  const problems = [];
  const detail = { time_zone: timeZone };
  try {
    const repeatables = await getQueue("comms-call-record-sweep-scheduler").getRepeatableJobs();
    const midnight = repeatables.filter((r) => r.every || /^0 0 /.test(String(r.pattern || "")));
    if (!repeatables.length) problems.push("the daily call-record sweep is not scheduled");
    if (midnight.length) problems.push("a midnight or interval repeatable is still registered for the daily sweep");
    const next = repeatables.map((r) => Number(r.next)).filter(Number.isFinite).sort((a, b) => a - b)[0];
    if (next) {
      const { spreadDelay } = require("../../jobs/handlers/comms-call-record-sweep-scheduler");
      const at = next + spreadDelay(slug);
      const hour = hourIn(at, timeZone);
      detail.next_run_utc = new Date(at).toISOString();
      detail.next_run_local_hour = hour;
      if (hour < 7 || hour >= 20) problems.push(`the next daily sweep runs at ${String(hour).padStart(2, "0")}:00 local time, outside the working day`);
    }
  } catch (err) {
    problems.push(`the schedule could not be read (${clean(err.message, 120)})`);
  }
  try {
    const { rows } = await envClient.query(
      `SELECT count(*) FILTER (WHERE status = 'RINGING' AND started_at < now() - interval '90 seconds')::int AS ring,
              count(*) FILTER (WHERE status = 'IN_CALL' AND connected_at < now() - interval '32 minutes')::int AS cap
         FROM comms_call
        WHERE status IN ('RINGING', 'IN_CALL')`,
    );
    detail.overdue_ring = rows[0].ring;
    detail.overdue_cap = rows[0].cap;
    if (rows[0].ring) problems.push(`${rows[0].ring} call(s) still ringing past the 60-second ring window`);
    if (rows[0].cap) problems.push(`${rows[0].cap} call(s) still live past the 30-minute cap`);
  } catch (err) {
    problems.push(`the call deadlines could not be read (${clean(err.message, 120)})`);
  }
  return problems.length
    ? {
      status: "fail", ms: Date.now() - started, code: "SCHEDULES", detail,
      cause: problems.join("; "),
      fix: "Tell support: the call scheduler needs attention (ring or cap deadlines, or the daily sweep).",
    }
    : { status: "pass", ms: Date.now() - started, detail };
}

// ── Start, read, list ────────────────────────────────────────────────────────

async function timeZoneOf(client) {
  try {
    return await require("../hr/attendance/attendance.reconcile").timezoneOf(client);
  } catch {
    /* @silent:parse — the corridor's zone is the documented default. */
    return "Africa/Douala";
  }
}

async function capStatus(liveClient) {
  const { used, nextDay } = await repo.todaysRuns(liveClient, await timeZoneOf(liveClient));
  return {
    limit: DAILY_CAP,
    used,
    remaining: Math.max(0, DAILY_CAP - used),
    next_available_at: used >= DAILY_CAP ? new Date(nextDay).toISOString() : null,
  };
}

/**
 * POST /smartcomm/diagnostics/runs. `liveClient` is the live schema (the run
 * table and the cap), `envClient` the environment being tested.
 */
async function startRun(liveClient, envClient, { actor, env = "live", tenantMeta, userAgent = null, appVersion = null, enqueue: injected = null }) {
  const run = await atomically(liveClient, async () => {
    await repo.lockCap(liveClient);
    await repo.purgeOld(liveClient, RETENTION_DAYS);
    const cap = await capStatus(liveClient);
    if (cap.used >= DAILY_CAP) {
      throw new AppError(
        "DIAGNOSTICS_DAILY_CAP",
        `Test calls are limited to ${DAILY_CAP} runs a day for your company. The next run is available at ${cap.next_available_at}.`,
        429,
        { next_available_at: cap.next_available_at, limit: DAILY_CAP },
      );
    }
    return repo.insertRun(liveClient, {
      userId: actor.user_id, env, steps: blankSteps(),
      appVersion: appVersion ? String(appVersion).slice(0, 60) : null,
      userAgent: userAgent ? String(userAgent).slice(0, 300) : null,
    });
  });
  const meta = { slug: tenantMeta && tenantMeta.slug, env };

  const schedules = await checkSchedules({ envClient, timeZone: await timeZoneOf(envClient), slug: meta.slug });
  let saved = await setStep(liveClient, run.run_id, "schedules", schedules, null);

  // Step 1 is proved by the worker picking this up; step 3 rides on it.
  const enqueue = injected || require("../../jobs/queue-producer").enqueue;
  try {
    await enqueue("comms-diagnostics", "roundtrip", {
      runId: run.run_id, tenantMeta, env, userId: actor.user_id, enqueuedAt: Date.now(),
    }, { jobId: `diag-roundtrip-${run.run_id}`, attempts: 1, removeOnComplete: true, removeOnFail: 50 });
    saved = await setStep(liveClient, run.run_id, "worker", { status: "running" }, null);
  } catch (err) {
    logger.warn({ err, run_id: run.run_id }, "diagnostics: could not enqueue the round trip");
    saved = await update(liveClient, run.run_id, (r) => ({
      ...r,
      steps: withStep(withStep(r.steps, "worker", {
        status: "fail", code: "QUEUE_UNREACHABLE",
        cause: `The job queue refused the check (${clean(err.message, 120)}).`,
        fix: "Tell support: the job queue (Redis) is unreachable from the server.",
      }), "signals", { status: "skipped", cause: "Needs the worker (step 1)." }),
    }), null);
  }
  return saved;
}

/** The watchdogs: a server step that never answered is failed on read. */
function applyWatchdogs(run, now = Date.now()) {
  let steps = run.steps;
  const since = (iso) => now - new Date(iso).getTime();
  const worker = steps.find((s) => s.key === "worker");
  if (worker && (worker.status === "pending" || worker.status === "running") && since(run.started_at) > WORKER_WATCHDOG_MS) {
    steps = withStep(steps, "worker", {
      status: "fail", code: "WORKER_DOWN",
      cause: `No worker picked up the check within ${WORKER_WATCHDOG_MS / 1000} s.`,
      fix: "Tell support: the background worker is not running, so calls will not be transcribed or timed out.",
    });
    steps = withStep(steps, "signals", { status: "skipped", cause: "Needs the worker (step 1)." });
  }
  const signal = steps.find((s) => s.key === "signals");
  if (signal && signal.status === "running" && signal.detail && signal.detail.emitted_at && since(signal.detail.emitted_at) > SIGNAL_WATCHDOG_MS) {
    steps = withStep(steps, "signals", {
      status: "fail", code: "SIGNAL_LOST",
      cause: "The worker sent a live signal and it never reached this screen.",
      fix: "Check that this screen is connected (no proxy blocking WebSockets); if it is, tell support the realtime relay is down.",
    });
  }
  for (const key of PIPELINE_KEYS) {
    const s = steps.find((x) => x.key === key);
    if (s && s.status === "running" && s.detail && s.detail.requested_at && since(s.detail.requested_at) > PIPELINE_WATCHDOG_MS) {
      steps = withStep(steps, key, {
        status: "fail", code: "PIPELINE_TIMEOUT",
        cause: "The worker did not finish this step in time.",
        fix: "Tell support: the worker is stalled or the provider did not answer.",
      });
    }
  }
  return steps === run.steps ? run : { ...run, steps };
}

async function getRun(liveClient, { runId, meta = null, now = Date.now() }) {
  const run = await repo.getRun(liveClient, runId);
  if (!run) throw new AppError("NOT_FOUND", "Test run not found", 404);
  if (run.status !== "RUNNING") return run;
  const checked = applyWatchdogs(run, now);
  if (checked === run) return run;
  return update(liveClient, runId, (r) => applyWatchdogs(r, now), meta);
}

async function listRuns(liveClient) {
  return { runs: await repo.listRuns(liveClient, { limit: 20 }), cap: await capStatus(liveClient) };
}

// ── What the runner's device does ────────────────────────────────────────────

/** Step 3's echo: the screen got the worker's signal. */
async function ackSignal(liveClient, { runId, actor, nonce, meta }) {
  return update(liveClient, runId, (run) => {
    ownRun(run, actor);
    const s = stepOf(run, "signals");
    if (!run.signal_nonce || nonce !== run.signal_nonce || !s || s.status !== "running") {
      throw new AppError("DIAGNOSTICS_BAD_SIGNAL", "That signal does not belong to this run", 409);
    }
    const ms = Date.now() - new Date(s.detail.emitted_at).getTime();
    return {
      ...run,
      steps: withStep(run.steps, "signals", ms <= SIGNAL_MAX_MS
        ? { status: "pass", ms, detail: s.detail }
        : {
          status: "fail", ms, detail: s.detail, code: "SIGNAL_SLOW",
          cause: `The live signal took ${(ms / 1000).toFixed(1)} s to reach this screen (limit ${SIGNAL_MAX_MS / 1000} s).`,
          fix: "A slow or proxied connection delays call events; try another network, then tell support.",
        }),
    };
  }, meta);
}

/** Step 4: a real ring-shaped push to this device, carrying the run's nonce. */
async function sendRing(liveClient, envClient, { runId, actor, endpoint, meta }) {
  const run = ownRun(await repo.getRun(liveClient, runId), actor);
  const nonce = crypto.randomBytes(9).toString("base64url");
  const result = await require("./smartcomm.call.service").testRing(envClient, { actor, endpoint, nonce });
  await setStep(liveClient, run.run_id, "ring", { status: "running", detail: { nonce, sent_at: new Date().toISOString() } }, meta);
  return { nonce, result };
}

/** Steps 4–8 as the device found them. Recording reports only a failure. */
async function reportStep(liveClient, { runId, actor, key, result, meta }) {
  if (!DEVICE_KEYS.has(key)) throw new AppError("VALIDATION_ERROR", `Step "${key}" is not reported by the device`, 422);
  if (key === "recording" && !["fail", "skipped"].includes(result.status)) {
    throw new AppError("VALIDATION_ERROR", "Recording passes on the server's check of the uploaded parts", 422);
  }
  return update(liveClient, runId, (run) => {
    ownRun(run, actor);
    const prev = stepOf(run, key);
    const detail = { ...((prev && prev.detail) || {}), ...(result.detail || {}) };
    return {
      ...run,
      steps: withStep(run.steps, key, {
        status: result.status,
        ms: Number.isFinite(result.ms) ? result.ms : null,
        code: result.code || null,
        cause: result.cause || null,
        fix: result.fix || null,
        detail,
      }),
    };
  }, meta);
}

function diagKey({ slug, runId, index, ext }) {
  return `tenant_${slug}/comms/diagnostics/${runId}/part_${index}.${ext}`;
}

/** Step 8: one of the three parts. Each must be a complete container on its own. */
async function uploadPart(liveClient, { runId, actor, index, file, slug, meta }) {
  const run = ownRun(await repo.getRun(liveClient, runId), actor);
  const i = Number(index);
  if (!Number.isInteger(i) || i < 1 || i > PARTS) throw new AppError("VALIDATION_ERROR", `part_index must be 1–${PARTS}`, 422);
  if (!file || !file.buffer || !file.buffer.length) throw new AppError("VALIDATION_ERROR", "The part is empty", 422);
  if (file.buffer.length > pipeline.MAX_PART_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "The part is too large", 413);
  const sniff = pipeline.sniffContainer(file.buffer);
  let entry;
  if (!sniff) {
    entry = { index: i, bytes: file.buffer.length, ok: false, error: "not a complete audio file (no container header)" };
  } else {
    const key = diagKey({ slug, runId: run.run_id, index: i, ext: sniff.ext });
    await storage.put(key, file.buffer, sniff.mediaType);
    entry = { index: i, bytes: file.buffer.length, ok: true, container: sniff.container, media_type: sniff.mediaType, key };
  }
  return update(liveClient, run.run_id, (r) => {
    const prev = stepOf(r, "recording");
    const parts = [...(((prev && prev.detail) || {}).parts || []).filter((p) => p.index !== i), entry]
      .sort((a, b) => a.index - b.index);
    const bad = parts.filter((p) => !p.ok);
    const patch = bad.length
      ? {
        status: "fail", code: "BAD_CONTAINER", detail: { parts },
        cause: `Part ${bad.map((p) => p.index).join(", ")} is not a complete audio file on its own, so it could not be transcribed.`,
        fix: "Update the browser; if it persists, tell support which browser and version (in this report).",
      }
      : parts.length >= PARTS
        ? { status: "pass", detail: { parts } }
        : { status: "running", detail: { parts } };
    return { ...r, steps: withStep(r.steps, "recording", patch) };
  }, meta);
}

/** Step 7's relay credential: a short-lived one for this run only. */
function iceForRun() {
  const turn = require("./smartcomm.turn.service");
  return turn.iceConfigFor({ token: `diag-${turn.newCallToken()}`, ttlSeconds: 120, relayOnly: true });
}

/** Steps 9–11: hand the run to the worker. Without one, they are skipped
 *  and the audio is removed here instead. */
async function finishRun(liveClient, { runId, actor, tenantMeta, env, meta, enqueue: injected = null }) {
  const run = ownRun(await repo.getRun(liveClient, runId), actor);
  const worker = stepOf(run, "worker");
  if (worker && worker.status === "fail") {
    const cleanup = await cleanUp(run);
    return update(liveClient, run.run_id, (r) => {
      let steps = withStep(r.steps, "transcription", { status: "skipped", cause: "Needs the worker (step 1)." });
      steps = withStep(steps, "summary", { status: "skipped", cause: "Needs the worker (step 1)." });
      steps = withStep(steps, "cleanup", cleanup);
      return { ...r, steps };
    }, meta);
  }
  const requested = { status: "running", detail: { requested_at: new Date().toISOString() } };
  const enqueue = injected || require("../../jobs/queue-producer").enqueue;
  await enqueue("comms-diagnostics", "pipeline", { runId: run.run_id, tenantMeta, env, userId: run.user_id }, {
    jobId: `diag-pipeline-${run.run_id}`, attempts: 1, removeOnComplete: true, removeOnFail: 50,
  });
  return update(liveClient, run.run_id, (r) => {
    let steps = r.steps;
    for (const key of PIPELINE_KEYS) steps = withStep(steps, key, requested);
    // A device step never reported (the page was closed mid-run) is skipped,
    // so the run can close.
    for (const s of r.steps) {
      if (DEVICE_KEYS.has(s.key) && !TERMINAL.has(s.status)) {
        steps = withStep(steps, s.key, { status: "skipped", cause: "Not reported by the device before the run finished." });
      }
    }
    return { ...r, steps };
  }, meta);
}

// ── The worker's half ────────────────────────────────────────────────────────

/** `comms-diagnostics` "roundtrip": step 1, then step 3's signal. */
async function roundtripJob({ withLiveDb, runId, userId, enqueuedAt, tenantMeta, env = "live", now = Date.now() }) {
  const meta = { slug: tenantMeta && tenantMeta.slug, env };
  const ms = Math.max(0, now - Number(enqueuedAt || now));
  const nonce = crypto.randomBytes(12).toString("base64url");
  const run = await withLiveDb((c) => update(c, runId, (r) => {
    if (r.status !== "RUNNING") return r;
    let steps = withStep(r.steps, "worker", ms <= WORKER_MAX_MS
      ? { status: "pass", ms }
      : {
        status: "fail", ms, code: "WORKER_SLOW",
        cause: `The worker took ${(ms / 1000).toFixed(1)} s to pick up the check (limit ${WORKER_MAX_MS / 1000} s).`,
        fix: "Tell support: the worker's queue is backed up, so call timeouts and transcripts will lag.",
      });
    steps = withStep(steps, "signals", { status: "running", detail: { emitted_at: new Date().toISOString() } });
    return { ...r, steps, signal_nonce: nonce };
  }, meta));
  if (run.status === "RUNNING") {
    realtime.publishToUser(meta.slug, env, userId, EVENT, { run_id: runId, kind: "signal", nonce });
  }
  return { ms };
}

async function recordUsage(envClient, { userId, provider, callType, audioSeconds = 0, usage = {}, ok = true, error = null }) {
  try {
    await governance.recordUsage(envClient, {
      userId, featureKey: FEATURE, provider, callType, audioSeconds,
      inputTokens: usage.promptTokenCount || usage.prompt_tokens || 0,
      outputTokens: usage.candidatesTokenCount || usage.completion_tokens || 0,
      wasSuccessful: ok, errorMessage: error ? clean(error, 200) : null,
    });
  } catch (err) {
    logger.warn({ err }, "diagnostics: usage could not be recorded");
  }
}

async function groqVendor() {
  try {
    return await require("../../services/platform/ai-vendor.service").getConfig("groq");
  } catch (err) {
    logger.warn({ err }, "diagnostics: groq vendor config unreadable; the env key is used");
    return null;
  }
}

/**
 * One clip through one route. `only` forces a provider; null is the
 * production order. Shared with the platform canary.
 */
async function transcribeClip({ audio, mediaType, only = null, vendor = null }) {
  const started = Date.now();
  const outcome = await pipeline.transcribePart({
    part: { recording_id: "diagnostics", media_type: mediaType },
    vendor,
    diagnostics: { audio, only },
  });
  return { ...outcome, ms: Date.now() - started };
}

/** The reference clips through Groq, then forced through Gemini. */
async function checkReferenceClips({ clips, onResult = null }) {
  const vendor = await groqVendor();
  const checks = [];
  for (const clip of clips) {
    for (const only of ["groq", "gemini"]) {
      const out = await transcribeClip({ audio: clip.audio, mediaType: "audio/ogg", only, vendor });
      const text = out.ok ? out.result.text : "";
      const match = out.ok ? wordMatch(clip.text, text) : 0;
      const lang = out.ok ? pipeline.toEnFr(out.result.detected_language || out.result.language, null) : null;
      const check = {
        label: `${clip.language.toUpperCase()} clip via ${only === "groq" ? "Groq" : "Gemini"}`,
        provider: only, language: clip.language,
        ok: out.ok && match >= MATCH_MIN && lang === clip.language,
        ms: out.ms, match: out.ok ? Math.round(match * 1000) / 1000 : null,
        detected_language: lang,
        error: !out.ok ? out.error : match < MATCH_MIN ? `only ${Math.round(match * 100)}% of the words matched` : lang !== clip.language ? `detected language ${lang || "unknown"}` : null,
      };
      checks.push(check);
      if (onResult) await onResult(check, out);
    }
  }
  return checks;
}

/** Gemini, then DeepSeek forced: schema, language, quoted key points. */
async function checkSummaries({ transcript, onResult = null }) {
  const checks = [];
  const call = { call_id: "diagnostics", caller_id: null, callee_id: null, duration_seconds: 60 };
  const parts = transcript.rows.map((r) => ({ side: r.side, part_index: r.part_index, transcript_status: "OK", duration_seconds: 30 }));
  const text = pipeline.buildAttributedTranscript({ rows: transcript.rows, names: transcript.names }).text;
  for (const only of ["gemini", "deepseek"]) {
    const started = Date.now();
    let out = null;
    let error = null;
    try {
      out = await pipeline.draftSummary({
        call, names: transcript.names, rows: transcript.rows, parts, language: transcript.language,
        verdict: { gaps: [], unrecorded: [], note: () => "" },
        diagnostics: { only },
      });
    } catch (err) {
      error = err.message;
    }
    const llmOk = !!(out && out.llm && out.llm.provider === only);
    const parsed = llmOk ? callSummary.sanitise(out.llm.text) : null;
    const lang = parsed ? guessLanguage(parsed.summary) : null;
    const unquoted = parsed ? parsed.key_points.filter((p) => !quotedFrom(p.text, text)) : [];
    const ok = !!parsed && parsed.key_points.length > 0 && (lang === null || lang === transcript.language) && unquoted.length === 0;
    const check = {
      label: `Summary via ${only === "gemini" ? "Gemini" : "DeepSeek"}`,
      provider: only, ok, ms: Date.now() - started,
      error: error ? clean(error, 160)
        : !llmOk ? `${only} did not answer (${out && out.llm ? `answered by ${out.llm.provider}` : "no reply"})`
          : !parsed ? "the reply did not match the summary schema"
            : !parsed.key_points.length ? "no key points"
              : lang && lang !== transcript.language ? `drafted in ${lang}, asked for ${transcript.language}`
                : unquoted.length ? `${unquoted.length} key point(s) not quoted from the transcript` : null,
    };
    checks.push(check);
    if (onResult) await onResult(check, out);
  }
  return checks;
}

async function cleanUp(run) {
  const rec = stepOf(run, "recording");
  const keys = (((rec && rec.detail) || {}).parts || []).map((p) => p.key).filter(Boolean);
  const failed = [];
  for (const key of keys) {
    try {
      await storage.delete(key);
    } catch (err) {
      failed.push(`${key.split("/").pop()}: ${clean(err.message, 80)}`);
    }
  }
  return failed.length
    ? {
      status: "fail", code: "CLEANUP", detail: { deleted: keys.length - failed.length },
      cause: `Test audio could not be deleted (${failed.join("; ")}).`,
      fix: "Tell support: storage refused a delete; the objects are under comms/diagnostics/<run>.",
    }
    : { status: "pass", detail: { deleted: keys.length } };
}

/** `comms-diagnostics` "pipeline": steps 9, 10 and 11. */
async function pipelineJob({ withLiveDb, withEnvDb, runId, userId, tenantMeta, env = "live" }) {
  const meta = { slug: tenantMeta && tenantMeta.slug, env };
  const run = await withLiveDb((c) => repo.getRun(c, runId));
  if (!run || run.status !== "RUNNING") return { skipped: true };
  const ref = referenceSet();
  const usage = (check, out, callType, audioSeconds) => withEnvDb((c) => recordUsage(c, {
    userId, provider: check.provider, callType, audioSeconds,
    usage: (out && (out.result || out.llm) && ((out.result || out.llm).usage || {})) || {},
    ok: check.ok, error: check.error,
  }));

  // 9 — the reference clips (forced per provider), then the runner's parts.
  const t0 = Date.now();
  const checks = await checkReferenceClips({
    clips: ref.clips,
    onResult: (check, out) => (out && out.attempts ? usage(check, out, "diagnostics.transcribe", 20) : null),
  });
  const rec = stepOf(run, "recording");
  const parts = (((rec && rec.detail) || {}).parts || []).filter((p) => p.ok && p.key);
  const vendor = await groqVendor();
  for (const p of parts) {
    let audio = null;
    try {
      audio = await storage.get(p.key);
    } catch (err) {
      checks.push({ label: `Your part ${p.index}`, ok: false, error: `stored part unreadable (${clean(err.message, 80)})` });
      continue;
    }
    const out = await transcribeClip({ audio, mediaType: p.media_type, only: null, vendor });
    const check = {
      label: `Your part ${p.index} (${out.ok ? out.result.provider : "no provider"})`,
      provider: out.ok ? out.result.provider : "groq", ok: out.ok, ms: out.ms,
      error: out.ok ? null : out.error,
    };
    checks.push(check);
    if (out.attempts) await usage(check, out, "diagnostics.transcribe", 3);
  }
  const failed = checks.filter((c) => !c.ok);
  const ownOnly = failed.length && failed.every((c) => c.label.startsWith("Your part"));
  const providerDown = (name) => failed.some((c) => c.provider === name && !c.label.startsWith("Your part"));
  await withLiveDb((c) => setStep(c, runId, "transcription", failed.length
    ? {
      status: ownOnly ? "warn" : "fail", ms: Date.now() - t0, detail: { checks },
      code: providerDown("groq") && providerDown("gemini") ? "TRANSCRIPTION_DOWN"
        : providerDown("groq") ? "GROQ_FAILED" : providerDown("gemini") ? "GEMINI_FAILED" : "OWN_PARTS",
      cause: failed.map((f) => `${f.label}: ${f.error || "failed"}`).join("; "),
      fix: ownOnly
        ? "The providers work; your own recording did not transcribe. Speak closer to the microphone and run it again."
        : "Tell support which provider failed (it is in this report): calls fall back to the other one, but only while it works.",
    }
    : { status: "pass", ms: Date.now() - t0, detail: { checks } }, meta));

  // 10 — the summary vendors, each forced.
  const s0 = Date.now();
  const sums = await checkSummaries({
    transcript: ref.summary,
    onResult: (check, out) => usage(check, out, "diagnostics.summary", 0),
  });
  const sumFailed = sums.filter((c) => !c.ok);
  await withLiveDb((c) => setStep(c, runId, "summary", sumFailed.length
    ? {
      status: "fail", ms: Date.now() - s0, detail: { checks: sums },
      code: sumFailed.length === 2 ? "SUMMARY_DOWN" : sumFailed[0].provider === "gemini" ? "GEMINI_SUMMARY_FAILED" : "DEEPSEEK_SUMMARY_FAILED",
      cause: sumFailed.map((f) => `${f.label}: ${f.error}`).join("; "),
      fix: "Tell support which summary provider failed (it is in this report).",
    }
    : { status: "pass", ms: Date.now() - s0, detail: { checks: sums } }, meta));

  // 11 — nothing of the run is left in storage.
  const latest = await withLiveDb((c) => repo.getRun(c, runId));
  const cleanup = await cleanUp(latest || run);
  await withLiveDb((c) => setStep(c, runId, "cleanup", cleanup, meta));
  return { transcription: checks.length, summary: sums.length };
}

module.exports = {
  // routes
  startRun,
  getRun,
  listRuns,
  ackSignal,
  sendRing,
  reportStep,
  uploadPart,
  iceForRun,
  finishRun,
  // jobs
  roundtripJob,
  pipelineJob,
  // shared with the platform canary
  checkReferenceClips,
  checkSummaries,
  referenceSet,
  // pure helpers (tested directly)
  blankSteps,
  wordMatch,
  guessLanguage,
  quotedFrom,
  finalStatus,
  withStep,
  applyWatchdogs,
  buildReport,
  checkSchedules,
  hourIn,
  diagKey,
  // constants
  STEPS,
  DAILY_CAP,
  RETENTION_DAYS,
  QUEUE,
  EVENT,
  MATCH_MIN,
  PARTS,
};
