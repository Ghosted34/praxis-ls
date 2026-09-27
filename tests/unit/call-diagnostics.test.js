"use strict";
/**
 * Comms → Setup → Test calls (calls audit PR-7, O5), against an in-memory run
 * table and mocked providers:
 *   - the 3-a-day cap, and its 429 with the next available time;
 *   - each step turns red on ITS injected failure and no other (a bad Groq
 *     key, a bad Gemini key, a stopped worker, a queue that refuses, a wrong
 *     TURN secret / denied push / blocked microphone as the device reports
 *     them, a part that is not a complete file);
 *   - a run writes nothing but its own row: no call table, no metric or
 *     signal, no chat, no notification;
 *   - the production code runs in its diagnostics mode, with the provider
 *     forced only there.
 */

jest.mock("../../src/services/ai/transcription.service", () => ({ transcribe: jest.fn() }));
jest.mock("../../src/services/ai/gemini-transcription.service", () => ({ transcribe: jest.fn() }));
jest.mock("../../src/services/ai/llm.service", () => ({ chat: jest.fn() }));
jest.mock("../../src/services/storage.service", () => ({
  put: jest.fn(async () => {}), get: jest.fn(), delete: jest.fn(async () => {}),
}));
jest.mock("../../src/realtime", () => ({ publishToUser: jest.fn(), publish: jest.fn() }));
jest.mock("../../src/modules/ai/governance/governance.service", () => ({ recordUsage: jest.fn(async () => ({})) }));
jest.mock("../../src/services/platform/ai-vendor.service", () => ({ getConfig: jest.fn(async () => null) }));
jest.mock("../../src/modules/smartcomm/smartcomm.call.signals", () => ({ providerResult: jest.fn(async () => {}) }));
jest.mock("../../src/modules/smartcomm/smartcomm.call.gate", () => ({ takeGemini: jest.fn(async () => true) }));
jest.mock("../../src/modules/notification/notification.service", () => ({ notifyMany: jest.fn(), notify: jest.fn() }));
jest.mock("../../src/services/platform/alert-routing.service", () => ({ raise: jest.fn() }));

const fs = require("fs");
const path = require("path");
const transcription = require("../../src/services/ai/transcription.service");
const gemini = require("../../src/services/ai/gemini-transcription.service");
const llm = require("../../src/services/ai/llm.service");
const storage = require("../../src/services/storage.service");
const realtime = require("../../src/realtime");
const governance = require("../../src/modules/ai/governance/governance.service");
const signals = require("../../src/modules/smartcomm/smartcomm.call.signals");
const notifications = require("../../src/modules/notification/notification.service");
const diag = require("../../src/modules/smartcomm/smartcomm.diagnostics.service");

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const tenantMeta = { slug: "acme", db_name: "acme" };
const WEBM = fs.readFileSync(path.join(__dirname, "..", "fixtures", "audio", "chrome-opus-3s.webm"));
const HEADERLESS = fs.readFileSync(path.join(__dirname, "..", "fixtures", "audio", "chrome-opus-headerless.webm"));

/**
 * The run table in memory, plus a log of every statement, so a test can say
 * what a run did NOT touch. Understands exactly the repo's statements.
 */
function db({ runsToday = 0, overdue = { ring: 0, cap: 0 } } = {}) {
  const runs = new Map();
  const log = [];
  let seq = 0;
  const client = {
    log,
    runs,
    async query(sql, params = []) {
      log.push(sql);
      if (/^SAVEPOINT|^RELEASE SAVEPOINT/.test(sql)) throw new Error("25P01 not in a transaction");
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (/FROM setting/.test(sql)) return { rows: [] };
      if (/^DELETE FROM comms_call_diagnostic_run/.test(sql)) return { rowCount: 0, rows: [] };
      if (/WITH day AS/.test(sql)) {
        const next = new Date(Date.now() + 3600e3).toISOString();
        return { rows: [{ used: runsToday + runs.size, next_day: next }] };
      }
      if (/^INSERT INTO comms_call_diagnostic_run/.test(sql)) {
        seq += 1;
        const row = {
          run_id: `run-${seq}`, user_id: params[0], env: params[1], steps: JSON.parse(params[2]),
          app_version: params[3], user_agent: params[4], started_at: new Date().toISOString(),
          finished_at: null, status: "RUNNING", report: null, signal_nonce: null,
        };
        runs.set(row.run_id, row);
        return { rows: [{ ...row }] };
      }
      if (/^SELECT \* FROM comms_call_diagnostic_run/.test(sql)) {
        const row = runs.get(params[0]);
        return { rows: row ? [JSON.parse(JSON.stringify(row))] : [] };
      }
      if (/^UPDATE comms_call_diagnostic_run/.test(sql)) {
        const row = runs.get(params[0]);
        Object.assign(row, {
          steps: JSON.parse(params[1]), status: params[2], finished_at: params[3], report: params[4], signal_nonce: params[5],
        });
        return { rows: [JSON.parse(JSON.stringify(row))] };
      }
      if (/FROM comms_call\s/.test(sql) && /RINGING/.test(sql)) return { rows: [overdue] };
      if (/FROM comms_call_diagnostic_run r/.test(sql)) return { rows: [...runs.values()] };
      throw new Error(`unexpected SQL in the fake: ${sql.slice(0, 80)}`);
    },
  };
  return client;
}

const queues = (repeatables) => () => ({ getRepeatableJobs: async () => repeatables });
// 10:00 in Douala (UTC+1) is 09:00 UTC.
const DAYTIME = [{ key: "k", pattern: "0 10 * * *", tz: "Africa/Douala", next: Date.UTC(2026, 8, 26, 9, 0) }];

jest.mock("../../src/jobs/queue-producer", () => {
  const repeatables = [{ key: "k", pattern: "0 10 * * *", tz: "Africa/Douala", next: Date.UTC(2026, 8, 26, 9, 0) }];
  return {
    enqueue: jest.fn(async () => ({})),
    getQueue: jest.fn(() => ({ getRepeatableJobs: async () => repeatables })),
  };
});
const { enqueue } = require("../../src/jobs/queue-producer");

const actor = { user_id: U1 };
const step = (run, key) => run.steps.find((s) => s.key === key);
const statusOf = (run) => Object.fromEntries(run.steps.map((s) => [s.key, s.status]));

const ref = diag.referenceSet();
const clipText = (audio) => (ref.clips.find((c) => c.audio.equals(audio)) || { text: "the driver called about the delivery" }).text;
const clipLang = (audio) => (ref.clips.find((c) => c.audio.equals(audio)) || { language: "en" }).language;
const summaryJson = (over = {}) => JSON.stringify({
  summary: "The truck with container four left the port and the team will send the signed delivery note today.",
  key_points: [{ text: "the truck with container four left the port at nine this morning", raised_by: "caller" }],
  follow_ups: [{ text: "send the signed delivery note", owner: "callee", due: null }],
  ...over,
});

function healthyProviders() {
  transcription.transcribe.mockImplementation(async ({ audio }) => ({
    text: clipText(audio), detected_language: clipLang(audio), audio_seconds: 18,
  }));
  gemini.transcribe.mockImplementation(async ({ audio }) => ({
    text: clipText(audio), detected_language: clipLang(audio), provider: "gemini", audio_seconds: 18,
  }));
  llm.chat.mockImplementation(async ({ vendorName }) => ({ provider: vendorName, text: summaryJson(), usage: {} }));
}

beforeEach(() => {
  jest.clearAllMocks();
  healthyProviders();
  storage.get.mockImplementation(async () => WEBM);
});

/** A run that reached the pipeline: worker and signal done, device steps reported, 3 parts up. */
async function runToPipeline(live, { parts = [WEBM, WEBM, WEBM] } = {}) {
  const run = await diag.startRun(live, live, { actor, env: "live", tenantMeta });
  await diag.roundtripJob({ withLiveDb: (fn) => fn(live), runId: run.run_id, userId: U1, enqueuedAt: Date.now(), tenantMeta });
  const nonce = live.runs.get(run.run_id).signal_nonce;
  await diag.ackSignal(live, { runId: run.run_id, actor, nonce });
  for (const key of ["ring", "microphone", "audio", "connection"]) {
    await diag.reportStep(live, { runId: run.run_id, actor, key, result: { status: "pass", ms: 100 } });
  }
  for (let i = 0; i < parts.length; i += 1) {
    await diag.uploadPart(live, { runId: run.run_id, actor, index: i + 1, file: { buffer: parts[i] }, slug: "acme" });
  }
  await diag.finishRun(live, { runId: run.run_id, actor, tenantMeta, env: "live" });
  return run.run_id;
}
const runPipeline = (live, runId) => diag.pipelineJob({
  withLiveDb: (fn) => fn(live), withEnvDb: (fn) => fn(live), runId, userId: U1, tenantMeta, env: "live",
});

describe("the pure helpers", () => {
  test("wordMatch is 1 − WER on words, ignoring case and punctuation", () => {
    expect(diag.wordMatch("Hello, world!", "hello world")).toBe(1);
    expect(diag.wordMatch("one two three four", "one two three")).toBeCloseTo(0.75);
    expect(diag.wordMatch("a b", "")).toBe(0);
  });
  test("guessLanguage tells English from French, and says nothing when unsure", () => {
    expect(diag.guessLanguage("The truck left the port and it will be at the warehouse")).toBe("en");
    expect(diag.guessLanguage("Le camion a quitté le port et il est à l'entrepôt pour la livraison")).toBe("fr");
    expect(diag.guessLanguage("OK")).toBeNull();
  });
  test("a key point is quoted when its words are in the transcript", () => {
    expect(diag.quotedFrom("left the port at nine", "The truck left the port at nine this morning")).toBe(true);
    expect(diag.quotedFrom("the ship sank in the harbour", "The truck left the port at nine")).toBe(false);
  });
  test("the verdict waits for every step, then fails on any red, warns on any amber or skip", () => {
    const steps = diag.blankSteps().map((s) => ({ ...s, status: "pass" }));
    expect(diag.finalStatus(steps)).toBe("PASSED");
    expect(diag.finalStatus(diag.withStep(steps, "audio", { status: "skipped" }))).toBe("WARN");
    expect(diag.finalStatus(diag.withStep(steps, "summary", { status: "fail" }))).toBe("FAILED");
    expect(diag.finalStatus(diag.withStep(steps, "summary", { status: "running" }))).toBeNull();
  });
  test("the steps are the plan's eleven, in order", () => {
    expect(diag.STEPS.map((s) => s.key)).toEqual([
      "worker", "schedules", "signals", "ring", "microphone", "audio", "connection",
      "recording", "transcription", "summary", "cleanup",
    ]);
  });
  test("the report carries timings and causes, never audio or a key", () => {
    const run = {
      run_id: "r1", env: "live", started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      status: "FAILED", user_agent: "Mozilla/5.0", app_version: "1.2.3",
      steps: diag.withStep(diag.blankSteps().map((s) => ({ ...s, status: "pass", ms: 12 })), "transcription", {
        status: "fail", code: "GROQ_FAILED", cause: "groq: 401 invalid api key: authorization=Bearer gsk_live_abc123",
        detail: { checks: [{ label: "EN clip via Groq", ok: false, ms: 300, error: "401 key=gsk_live_abc123" }] },
      }),
    };
    const text = diag.buildReport(run);
    expect(text).toMatch(/Run: r1/);
    expect(text).toMatch(/9\. Transcription — FAIL/);
    expect(text).toMatch(/code: GROQ_FAILED/);
    expect(text).not.toMatch(/gsk_live_abc123/);
  });
});

describe("the cap: 3 runs per tenant per day", () => {
  test("the fourth start is refused with 429 and the time the next run is available", async () => {
    const live = db({ runsToday: 3 });
    await expect(diag.startRun(live, live, { actor, env: "live", tenantMeta })).rejects.toMatchObject({
      status: 429, code: "DIAGNOSTICS_DAILY_CAP",
      details: { next_available_at: expect.any(String), limit: 3 },
    });
    expect(live.runs.size).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("the count and the insert happen under the cap's advisory lock, in one transaction", async () => {
    const live = db({ runsToday: 2 });
    await diag.startRun(live, live, { actor, env: "live", tenantMeta });
    const i = (re) => live.log.findIndex((s) => re.test(s));
    expect(i(/^BEGIN/)).toBeGreaterThanOrEqual(0);
    expect(i(/pg_advisory_xact_lock/)).toBeGreaterThan(i(/^BEGIN/));
    expect(i(/WITH day AS/)).toBeGreaterThan(i(/pg_advisory_xact_lock/));
    expect(i(/^INSERT INTO comms_call_diagnostic_run/)).toBeGreaterThan(i(/WITH day AS/));
    expect(i(/^COMMIT/)).toBeGreaterThan(i(/^INSERT INTO comms_call_diagnostic_run/));
    await expect(diag.startRun(live, live, { actor, env: "live", tenantMeta })).rejects.toMatchObject({ status: 429 });
  });
});

describe("a healthy run", () => {
  test("every step passes, the run closes PASSED with a report, and step 1/3 went through the worker", async () => {
    const live = db();
    const runId = await runToPipeline(live);
    expect(enqueue).toHaveBeenCalledWith("comms-diagnostics", "roundtrip", expect.objectContaining({ runId }), expect.any(Object));
    expect(enqueue).toHaveBeenCalledWith("comms-diagnostics", "pipeline", expect.objectContaining({ runId }), expect.any(Object));
    await runPipeline(live, runId);
    const run = live.runs.get(runId);
    expect(statusOf(run)).toEqual(Object.fromEntries(diag.STEPS.map((s) => [s.key, "pass"])));
    expect(run.status).toBe("PASSED");
    expect(run.report).toMatch(/Result: PASSED/);
    // Reference clips twice each (Groq, then Gemini forced), plus 3 own parts.
    expect(transcription.transcribe).toHaveBeenCalledTimes(2 + 3);
    expect(gemini.transcribe).toHaveBeenCalledTimes(2);
    // Summaries: each vendor forced, no fallback hop.
    expect(llm.chat.mock.calls.map((c) => [c[0].vendorName, c[0].singleVendor])).toEqual([["gemini", true], ["deepseek", true]]);
    // The audio went under the run's own prefix and is gone.
    expect(storage.put.mock.calls.map((c) => c[0])).toEqual([1, 2, 3].map((i) => `tenant_acme/comms/diagnostics/${runId}/part_${i}.webm`));
    expect(storage.delete.mock.calls.map((c) => c[0]).sort()).toEqual(storage.put.mock.calls.map((c) => c[0]).sort());
  });

  test("a run writes nothing but its own row: no call table, metric, signal, chat or notification", async () => {
    const live = db();
    const runId = await runToPipeline(live);
    await runPipeline(live, runId);
    const writes = live.log.filter((s) => /^\s*(INSERT|UPDATE|DELETE)/i.test(s));
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((s) => /comms_call_diagnostic_run/.test(s))).toBe(true);
    expect(signals.providerResult).not.toHaveBeenCalled();
    expect(notifications.notifyMany).not.toHaveBeenCalled();
    expect(realtime.publishToUser.mock.calls.every((c) => c[3] === "comms:diagnostics")).toBe(true);
    // Usage is recorded, under the diagnostics feature line only.
    expect(governance.recordUsage).toHaveBeenCalled();
    expect(governance.recordUsage.mock.calls.every((c) => c[1].featureKey === "diagnostics")).toBe(true);
  });
});

describe("each step turns red on its own failure, and only that step", () => {
  const redOnly = (run, keys) => {
    const s = statusOf(run);
    for (const k of Object.keys(s)) expect([k, s[k]]).toEqual([k, keys.includes(k) ? "fail" : "pass"]);
  };

  test("a bad Groq key: step 9, naming Groq", async () => {
    transcription.transcribe.mockRejectedValue(Object.assign(new Error("401 Invalid API Key"), { status: 401 }));
    const live = db();
    const runId = await runToPipeline(live);
    await runPipeline(live, runId);
    const run = live.runs.get(runId);
    redOnly(run, ["transcription"]);
    expect(step(run, "transcription").code).toBe("GROQ_FAILED");
    // The runner's own parts still transcribed, through Gemini (O1).
    expect(step(run, "transcription").detail.checks.filter((c) => /Your part/.test(c.label)).every((c) => c.ok)).toBe(true);
  });

  test("a bad Gemini key: the Gemini transcription and the Gemini summary, naming Gemini", async () => {
    gemini.transcribe.mockRejectedValue(new Error("403 API key not valid"));
    llm.chat.mockImplementation(async ({ vendorName }) => (vendorName === "gemini"
      ? { provider: null, text: "The AI providers are unavailable" }
      : { provider: vendorName, text: summaryJson() }));
    const live = db();
    const runId = await runToPipeline(live);
    await runPipeline(live, runId);
    const run = live.runs.get(runId);
    redOnly(run, ["transcription", "summary"]);
    expect(step(run, "transcription").code).toBe("GEMINI_FAILED");
    expect(step(run, "summary").code).toBe("GEMINI_SUMMARY_FAILED");
  });

  test("a stopped worker: step 1 red, step 3 skipped (it is the worker's emitter), 9–11 skipped", async () => {
    const live = db();
    const run = await diag.startRun(live, live, { actor, env: "live", tenantMeta });
    const later = Date.now() + 20000;
    const read = await diag.getRun(live, { runId: run.run_id, now: later });
    expect(step(read, "worker")).toMatchObject({ status: "fail", code: "WORKER_DOWN" });
    expect(step(read, "signals").status).toBe("skipped");
    expect(step(read, "schedules").status).toBe("pass");
    for (const key of ["ring", "microphone", "audio", "connection"]) {
      await diag.reportStep(live, { runId: run.run_id, actor, key, result: { status: "pass" } });
    }
    for (const i of [1, 2, 3]) await diag.uploadPart(live, { runId: run.run_id, actor, index: i, file: { buffer: WEBM }, slug: "acme" });
    await diag.finishRun(live, { runId: run.run_id, actor, tenantMeta, env: "live" });
    const done = live.runs.get(run.run_id);
    expect(statusOf(done)).toMatchObject({ worker: "fail", signals: "skipped", transcription: "skipped", summary: "skipped", cleanup: "pass" });
    expect(Object.values(statusOf(done)).filter((s) => s === "fail")).toHaveLength(1);
    expect(done.status).toBe("FAILED");
  });

  test("a queue that refuses the job: step 1 red at once, naming the queue", async () => {
    const live = db();
    const run = await diag.startRun(live, live, {
      actor, env: "live", tenantMeta, enqueue: async () => { throw new Error("ECONNREFUSED 6379"); },
    });
    expect(step(run, "worker")).toMatchObject({ status: "fail", code: "QUEUE_UNREACHABLE" });
    expect(step(run, "signals").status).toBe("skipped");
    expect(step(run, "schedules").status).toBe("pass");
  });

  test("a wrong TURN secret, denied push and a blocked microphone are the device's steps 7, 4 and 5", async () => {
    const live = db();
    const run = await diag.startRun(live, live, { actor, env: "live", tenantMeta });
    const report = (key, result) => diag.reportStep(live, { runId: run.run_id, actor, key, result });
    await report("connection", { status: "fail", code: "RELAY_REFUSED", cause: "The relay refused the credential (401)." });
    let s = statusOf(live.runs.get(run.run_id));
    expect(s.connection).toBe("fail");
    expect(Object.entries(s).filter(([, v]) => v === "fail").map(([k]) => k)).toEqual(["connection"]);
    await report("ring", { status: "fail", code: "PUSH_DENIED" });
    await report("microphone", { status: "fail", code: "MIC_BLOCKED" });
    s = statusOf(live.runs.get(run.run_id));
    expect(Object.entries(s).filter(([, v]) => v === "fail").map(([k]) => k).sort()).toEqual(["connection", "microphone", "ring"]);
  });

  test("a part that is not a complete file: step 8, and it is never stored", async () => {
    const live = db();
    const run = await diag.startRun(live, live, { actor, env: "live", tenantMeta });
    await diag.uploadPart(live, { runId: run.run_id, actor, index: 1, file: { buffer: WEBM }, slug: "acme" });
    const after = await diag.uploadPart(live, { runId: run.run_id, actor, index: 2, file: { buffer: HEADERLESS }, slug: "acme" });
    expect(step(after, "recording")).toMatchObject({ status: "fail", code: "BAD_CONTAINER" });
    expect(storage.put).toHaveBeenCalledTimes(1);
  });

  test("the schedules step fails when a ring deadline is overdue or the sweep runs at night", async () => {
    const overdue = await diag.checkSchedules({ envClient: db({ overdue: { ring: 2, cap: 0 } }), timeZone: "Africa/Douala", slug: "acme", queues: queues(DAYTIME) });
    expect(overdue).toMatchObject({ status: "fail", code: "SCHEDULES" });
    expect(overdue.cause).toMatch(/2 call\(s\) still ringing/);
    const night = await diag.checkSchedules({
      envClient: db(), timeZone: "Africa/Douala", slug: "acme",
      queues: queues([{ key: "m", pattern: "0 0 * * *", next: Date.UTC(2026, 8, 26, 23, 0) }]),
    });
    expect(night.status).toBe("fail");
    expect(night.cause).toMatch(/midnight/);
  });
});

describe("the device's reports", () => {
  test("only the device's steps, and recording only as a failure", async () => {
    const live = db();
    const run = await diag.startRun(live, live, { actor, env: "live", tenantMeta });
    await expect(diag.reportStep(live, { runId: run.run_id, actor, key: "transcription", result: { status: "pass" } }))
      .rejects.toMatchObject({ status: 422 });
    await expect(diag.reportStep(live, { runId: run.run_id, actor, key: "recording", result: { status: "pass" } }))
      .rejects.toMatchObject({ status: 422 });
  });

  test("someone else's run is not found", async () => {
    const live = db();
    const run = await diag.startRun(live, live, { actor, env: "live", tenantMeta });
    await expect(diag.reportStep(live, { runId: run.run_id, actor: { user_id: U2 }, key: "audio", result: { status: "pass" } }))
      .rejects.toMatchObject({ status: 404 });
  });

  test("the signal echo must carry the run's nonce", async () => {
    const live = db();
    const run = await diag.startRun(live, live, { actor, env: "live", tenantMeta });
    await diag.roundtripJob({ withLiveDb: (fn) => fn(live), runId: run.run_id, userId: U1, enqueuedAt: Date.now(), tenantMeta });
    expect(realtime.publishToUser).toHaveBeenCalledWith("acme", "live", U1, "comms:diagnostics",
      expect.objectContaining({ kind: "signal", nonce: expect.any(String) }));
    await expect(diag.ackSignal(live, { runId: run.run_id, actor, nonce: "not-the-nonce" })).rejects.toMatchObject({ status: 409 });
    const nonce = live.runs.get(run.run_id).signal_nonce;
    expect(step(await diag.ackSignal(live, { runId: run.run_id, actor, nonce }), "signals").status).toBe("pass");
  });

  test("a slow worker fails step 1 on the measured time", async () => {
    const live = db();
    const run = await diag.startRun(live, live, { actor, env: "live", tenantMeta });
    await diag.roundtripJob({ withLiveDb: (fn) => fn(live), runId: run.run_id, userId: U1, enqueuedAt: Date.now() - 9000, tenantMeta });
    expect(step(live.runs.get(run.run_id), "worker")).toMatchObject({ status: "fail", code: "WORKER_SLOW" });
  });
});
