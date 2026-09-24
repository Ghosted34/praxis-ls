"use strict";

/**
 * Calls audit H1, against a real schema: a recorded call goes through the real
 * routes, the real part and finalise job handlers, and the real SQL, from the
 * first uploaded part to a sent summary.
 *
 * Real here: Postgres (every call, part, transcript, summary, message and
 * notification row), the smartcomm router with multer, the controller, the
 * pipeline, the repo, the job handlers and the notification service. Faked:
 * login and permissions (a header names the user), object storage (a Map),
 * the queue (jobs are collected and run by the test, in order), and the two
 * outside vendors. The transcription stub REJECTS HEADERLESS AUDIT: a part
 * must start with a container header and, where ffmpeg is installed, decode on
 * its own, which is what a real provider needs. That is what the old recorder
 * got wrong (A3), so it cannot come back unnoticed.
 *
 * Runs only with DATABASE_URL pointing at a provisioned tenant (search_path =
 * the tenant schema); self-skips otherwise, like every suite in this directory.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const express = require("express");
const request = require("supertest");

const mockHasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const mockState = { pool: null, objects: new Map(), jobs: [], vendorCalls: [], llmCalls: 0, failAudio: new Set() };

jest.mock("../../src/middleware/auth", () => ({
  authMiddleware: (req, _res, next) => {
    req.user = { user_id: req.headers["x-user-id"] || null, display_name: "Test" };
    next();
  },
}));
jest.mock("../../src/middleware/rbac", () => ({
  requirePermission: () => (_req, _res, next) => next(),
  requireCeo: () => (_req, _res, next) => next(),
  // The thread's ERP cards resolve against these; none are on this thread.
  readPermissions: async (_req, specs = []) => specs.map(() => false),
}));
jest.mock("../../src/middleware/feature-gate", () => ({
  requireFeature: () => (_req, _res, next) => next(),
}));
jest.mock("../../src/services/storage.service", () => ({
  put: async (buffer, { key }) => { mockState.objects.set(key, Buffer.from(buffer)); },
  get: async (key) => {
    if (!mockState.objects.has(key)) throw new Error(`no object ${key}`);
    return mockState.objects.get(key);
  },
  delete: async (key) => { mockState.objects.delete(key); },
}));
jest.mock("../../src/jobs/queue-producer", () => ({
  enqueue: async (queue, name, data, opts = {}) => {
    mockState.jobs.push({ queue, name, data, opts });
    return { id: opts.jobId || `${queue}-${mockState.jobs.length}` };
  },
}));
jest.mock("../../src/services/tenant/registry.service", () => ({
  withTenantConnection: async (meta, env, fn) => {
    const c = await mockState.pool.connect();
    try {
      return await fn(c);
    } finally {
      c.release();
    }
  },
}));
jest.mock("../../src/realtime", () => ({ publishToUser: jest.fn(), publish: jest.fn() }));
jest.mock("../../src/services/platform/ai-vendor.service", () => ({ getConfig: async () => null }));
jest.mock("../../src/services/platform/alert-routing.service", () => ({ raise: jest.fn(async () => {}) }));
jest.mock("../../src/modules/ai/governance/governance.service", () => ({
  canUseFeature: async () => ({ allowed: true }),
  recordUsage: async () => {},
}));
jest.mock("../../src/services/ai/llm.service", () => ({
  chat: async () => {
    mockState.llmCalls += 1;
    return {
      provider: "gemini",
      text: JSON.stringify({
        summary: "They agreed the Friday delivery.",
        key_points: [{ text: "livraison vendredi", raised_by: "callee" }],
        follow_ups: [],
      }),
    };
  },
}));

/** A decoder's opinion of a part, as the providers have it. */
function mockAssertDecodable(audio, label) {
  const b = Buffer.from(audio);
  const header = (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3)
    || b.toString("latin1", 4, 8) === "ftyp" || b.toString("latin1", 0, 4) === "OggS";
  if (!header) throw Object.assign(new Error(`${label}: invalid audio, no container header`), { status: 400 });
  if (mockHasFfmpeg) {
    const probe = require("child_process").spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-f", "null", "-"], { input: b });
    if (probe.status !== 0) throw Object.assign(new Error(`${label}: could not decode`), { status: 400 });
  }
}
jest.mock("../../src/services/ai/transcription.service", () => ({
  transcribe: async ({ audio }) => {
    mockState.vendorCalls.push("groq");
    const key = [...mockState.objects.entries()].find(([, v]) => v.equals(audio))?.[0] || "";
    if ([...mockState.failAudio].some((k) => key.endsWith(k))) throw new Error("groq: 503");
    mockAssertDecodable(audio, "groq");
    return { text: `words of ${require("path").basename(key)}`, detected_language: "english", provider: "groq", audio_seconds: 2 };
  },
}));
jest.mock("../../src/services/ai/gemini-transcription.service", () => ({
  transcribe: async ({ audio }) => {
    mockState.vendorCalls.push("gemini");
    const key = [...mockState.objects.entries()].find(([, v]) => v.equals(audio))?.[0] || "";
    if ([...mockState.failAudio].some((k) => key.endsWith(k))) throw new Error("gemini: 500");
    mockAssertDecodable(audio, "gemini");
    return { text: `gemini words of ${require("path").basename(key)}`, detected_language: "en", provider: "gemini" };
  },
}));

const FIXTURES = path.join(__dirname, "..", "fixtures", "audio");
const HEADERLESS = fs.readFileSync(path.join(FIXTURES, "chrome-opus-headerless.webm"));

/** Distinct, complete WebM/Opus files; the committed Chromium recording when
 *  ffmpeg is not installed. */
function recording(i) {
  if (!mockHasFfmpeg) return fs.readFileSync(path.join(FIXTURES, "chrome-opus-3s.webm"));
  const out = path.join(os.tmpdir(), `praxis-call-part-${process.pid}-${i}.webm`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=${300 + i * 40}:duration=2`,
    "-ac", "1", "-c:a", "libopus", "-b:a", "32k", out]);
  const bytes = fs.readFileSync(out);
  fs.rmSync(out, { force: true });
  return bytes;
}

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("a recorded call, end to end on a real schema (audit H1)", () => {
  let app;
  let caller;
  let callee;
  let groupId;
  const tenantMeta = { slug: "citenant", db_name: "tenant_citenant" };
  const handlers = {
    "call-transcribe-part": require("../../src/jobs/handlers/call-transcribe-part"),
    "call-finalise": require("../../src/jobs/handlers/call-finalise"),
  };

  const q = (sql, params) => mockState.pool.query(sql, params);

  /** Run every queued part and finalise job, in order, until none are left. */
  async function runJobs() {
    const ran = [];
    for (let guard = 0; guard < 50; guard += 1) {
      const i = mockState.jobs.findIndex((j) => handlers[j.queue] && !(j.opts.delay > 0));
      if (i === -1) break;
      const [job] = mockState.jobs.splice(i, 1);
      ran.push(job.opts.jobId);
      await handlers[job.queue]({ data: job.data });
    }
    return ran;
  }

  const as = (userId) => ({
    post: (url) => request(app).post(url).set("x-user-id", userId),
    get: (url) => request(app).get(url).set("x-user-id", userId),
  });

  async function newCall() {
    const { rows } = await q(
      `INSERT INTO comms_call (group_id, caller_id, callee_id, status, connected_at)
       VALUES ($1, $2, $3, 'IN_CALL', now() - interval '5 minutes') RETURNING call_id`,
      [groupId, caller, callee],
    );
    return rows[0].call_id;
  }

  async function upload(userId, callId, side, index, bytes) {
    return as(userId).post(`/calls/${callId}/recording`)
      .field("side", side)
      .field("part_index", String(index))
      .field("part_count", String(index))
      .field("duration_ms", "2000")
      .field("language", "en")
      .attach("file", bytes, { filename: `${side}-${index}.webm`, contentType: "audio/webm" });
  }

  beforeAll(async () => {
    const { Pool } = require("pg");
    mockState.pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
    const stamp = `${Date.now()}-${process.pid}`;
    const users = await q(
      `INSERT INTO app_user (email, full_name, password_hash)
       VALUES ($1, 'Awa Diallo', 'x'), ($2, 'Bruno Kamga', 'x') RETURNING user_id`,
      [`h1-caller-${stamp}@example.test`, `h1-callee-${stamp}@example.test`],
    );
    [caller, callee] = users.rows.map((r) => r.user_id);
    const g = await q("INSERT INTO comms_group (kind, name) VALUES ('DIRECT', 'h1 call') RETURNING group_id");
    groupId = g.rows[0].group_id;
    await q("INSERT INTO comms_member (group_id, user_id) VALUES ($1, $2), ($1, $3)", [groupId, caller, callee]);
    await q(
      `INSERT INTO feature_state (feature_key, state, source) VALUES ('call_recording', 'on', 'default')
       ON CONFLICT (feature_key) DO UPDATE SET state = 'on'`,
    );

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.tenant = tenantMeta;
      req.env = "live";
      req.tenantDb = async (fn) => {
        const c = await mockState.pool.connect();
        try {
          return await fn(c);
        } finally {
          c.release();
        }
      };
      next();
    });
    app.use(require("../../src/modules/smartcomm/smartcomm.routes").router);
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ code: err.code, message: err.message }));
  });

  afterAll(async () => {
    if (!mockState.pool) return;
    try {
      await q("DELETE FROM comms_message WHERE group_id = $1", [groupId]);
      await q("DELETE FROM comms_call WHERE group_id = $1", [groupId]);
      await q("DELETE FROM comms_group WHERE group_id = $1", [groupId]);
      await q("DELETE FROM notification WHERE user_id = ANY($1::uuid[])", [[caller, callee]]);
    } catch {
      /* @silent:teardown — a leftover test row in a throwaway CI database */
    }
    await mockState.pool.end();
  });

  beforeEach(() => {
    mockState.jobs = [];
    mockState.vendorCalls = [];
    mockState.llmCalls = 0;
    mockState.failAudio = new Set();
  });

  it("the stub is a real check: it refuses a headerless part (control for A3)", () => {
    expect(() => mockAssertDecodable(HEADERLESS, "stub")).toThrow(/no container header|could not decode/);
    expect(() => mockAssertDecodable(recording(0), "stub")).not.toThrow();
  });

  it("parts transcribe as they upload; both sides declare; one certified transcript, one notification, a readable summary; one message for a double tap", async () => {
    const callId = await newCall();

    // A3: the server refuses a headerless part before storing anything.
    const bad = await upload(caller, callId, "caller", 1, HEADERLESS);
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe("RECORDING_NOT_AUDIO");
    expect(mockState.objects.size).toBe(0);

    // During the call: three caller parts and two callee parts, each a
    // complete file, each transcribed as soon as it lands (A2).
    for (const i of [1, 2, 3]) expect((await upload(caller, callId, "caller", i, recording(i))).status).toBe(201);
    for (const i of [1, 2]) expect((await upload(callee, callId, "callee", i, recording(10 + i))).status).toBe(201);
    expect(mockState.jobs.map((j) => j.opts.jobId)).toEqual([
      `callpart-${callId}-caller-1`, `callpart-${callId}-caller-2`, `callpart-${callId}-caller-3`,
      `callpart-${callId}-callee-1`, `callpart-${callId}-callee-2`,
    ]);
    await runJobs();
    expect(mockState.vendorCalls).toEqual(["groq", "groq", "groq", "groq", "groq"]);

    // Hang up: the deadline finalise is queued ten minutes out.
    expect((await as(caller).post(`/calls/${callId}/hangup`).send({})).status).toBe(200);
    const deadline = mockState.jobs.find((j) => j.opts.jobId === `callfinaldl-${callId}`);
    expect(deadline.opts.delay).toBe(10 * 60 * 1000);

    // Both sides declare; the second declaration starts finalise at once.
    expect((await as(caller).post(`/calls/${callId}/recording/complete`).send({ side: "caller", parts: 3 })).body.data)
      .toEqual({ call_id: callId, side: "caller", parts: 3, received: 3 });
    expect(mockState.jobs.some((j) => j.opts.jobId === `callfinal-${callId}`)).toBe(false);
    await as(callee).post(`/calls/${callId}/recording/complete`).send({ side: "callee", parts: 2 });
    expect(mockState.jobs.some((j) => j.opts.jobId === `callfinal-${callId}`)).toBe(true);
    await runJobs();

    const call = (await q("SELECT * FROM comms_call WHERE call_id = $1", [callId])).rows[0];
    expect(call.transcription_state).toBe("CERTIFIED");
    const transcript = await q(
      "SELECT side, part_index, provider, certified FROM comms_call_transcript WHERE call_id = $1 AND is_current ORDER BY side, part_index",
      [callId],
    );
    expect(transcript.rows).toHaveLength(5);
    expect(transcript.rows.every((r) => r.certified && r.provider === "groq")).toBe(true);
    const notes = await q(
      "SELECT user_id, link_url FROM notification WHERE event_type_key = 'comms.call_summary_ready' AND entity_ref = $1",
      [`comms_call:${callId}`],
    );
    expect(notes.rows).toEqual([expect.objectContaining({ user_id: caller })]);
    expect(notes.rows[0].link_url).toContain(`summary=${callId}`);
    expect(mockState.llmCalls).toBe(1);

    // Readable: the caller's draft, and it is pinned in the conversation (O3).
    const summary = await as(caller).get(`/calls/${callId}/summary`);
    expect(summary.body.data.summary).toEqual(expect.objectContaining({
      summary_text: "They agreed the Friday delivery.", draft_status: "PENDING_REVIEW",
    }));
    const thread = await as(caller).get(`/channels/${groupId}/messages`);
    expect(thread.status).toBe(200);
    expect(thread.body.data.pending_call_summaries.map((p) => p.call_id)).toEqual([callId]);
    const calleeThread = await as(callee).get(`/channels/${groupId}/messages`);
    expect(calleeThread.body.data.pending_call_summaries).toEqual([]);

    // Re-running finalise, as the deadline job will: no provider, no LLM.
    mockState.vendorCalls = [];
    await handlers["call-finalise"]({ data: { ...deadline.data } });
    expect(mockState.vendorCalls).toEqual([]);
    expect(mockState.llmCalls).toBe(1);

    // B7: a double tap posts one message.
    const sends = await Promise.all([
      as(caller).post(`/calls/${callId}/summary/send`).send({ summary_text: "They agreed the Friday delivery." }),
      as(caller).post(`/calls/${callId}/summary/send`).send({ summary_text: "They agreed the Friday delivery." }),
    ]);
    expect(sends.map((r) => r.status).sort()).toEqual([200, 409]);
    const posted = await q(
      `SELECT m.message_id FROM comms_message m JOIN comms_attachment a ON a.message_id = m.message_id
       WHERE a.call_id = $1`,
      [callId],
    );
    expect(posted.rows).toHaveLength(1);
    const sent = (await q("SELECT draft_status, sent_message_id FROM comms_call_summary WHERE call_id = $1", [callId])).rows[0];
    expect(sent).toEqual({ draft_status: "SENT", sent_message_id: posted.rows[0].message_id });
    const after = (await as(caller).get(`/channels/${groupId}/messages`)).body.data;
    expect(after.pending_call_summaries).toEqual([]);

    // C4 on real SQL: the posted message carries the card...
    const cardOf = (page, messageId) => {
      const m = (page.messages || page.items || page).find((x) => x.message_id === messageId);
      return m && m.attachments.find((a) => a.attachment_kind === "CALL");
    };
    expect(cardOf(after, posted.rows[0].message_id).call_card)
      .toEqual(expect.objectContaining({ summary_text: "They agreed the Friday delivery." }));
    // ...a stranger cannot post one naming this call...
    const stamp = `${Date.now()}-c4`;
    const [stranger] = (await q(
      "INSERT INTO app_user (email, full_name, password_hash) VALUES ($1, 'Eve', 'x') RETURNING user_id",
      [`c4-${stamp}@example.test`],
    )).rows.map((r) => r.user_id);
    const own = (await q("INSERT INTO comms_group (kind, name) VALUES ('PROJECT', 'c4') RETURNING group_id")).rows[0].group_id;
    await q("INSERT INTO comms_member (group_id, user_id) VALUES ($1, $2)", [own, stranger]);
    const forged = await as(stranger).post(`/channels/${own}/messages`)
      .send({ body: "look", attachments: [{ attachment_kind: "CALL", call_id: callId }] });
    expect(forged.status).toBe(422);
    // ...and a CALL row that got in some other way resolves to nothing.
    const m = (await q(
      "INSERT INTO comms_message (group_id, sender_user_id, body) VALUES ($1, $2, 'x') RETURNING message_id",
      [own, stranger],
    )).rows[0].message_id;
    await q("INSERT INTO comms_attachment (message_id, attachment_kind, call_id) VALUES ($1, 'CALL', $2)", [m, callId]);
    const theirs = (await as(stranger).get(`/channels/${own}/messages`)).body.data;
    expect(cardOf(theirs, m).call_card).toBeNull();
  });

  it("O1: a part both providers fail is named in the draft and never retried automatically", async () => {
    const callId = await newCall();
    for (const i of [1, 2]) await upload(caller, callId, "caller", i, recording(20 + i));
    await upload(callee, callId, "callee", 1, recording(30));
    mockState.failAudio = new Set(["caller_002.webm"]);
    await runJobs();
    expect(mockState.vendorCalls.filter((v) => v === "gemini")).toHaveLength(1);

    await as(caller).post(`/calls/${callId}/hangup`).send({});
    await as(caller).post(`/calls/${callId}/recording/complete`).send({ side: "caller", parts: 2 });
    await as(callee).post(`/calls/${callId}/recording/complete`).send({ side: "callee", parts: 1 });
    await runJobs();

    const call = (await q("SELECT transcription_state FROM comms_call WHERE call_id = $1", [callId])).rows[0];
    expect(call.transcription_state).toBe("TRANSCRIPTION_FAILED");
    const draft = (await q("SELECT summary_text FROM comms_call_summary WHERE call_id = $1", [callId])).rows[0];
    expect(draft.summary_text).toMatch(/Not transcribed: 00:02–00:04 \(Awa Diallo\)\.$/);

    // The sweep restarts only work that never ran: nothing for this part.
    mockState.jobs = [];
    mockState.vendorCalls = [];
    const pipeline = require("../../src/modules/smartcomm/smartcomm.call.pipeline.service");
    const c = await mockState.pool.connect();
    try {
      await pipeline.sweepStalled(c, { tenantMeta, env: "live" });
    } finally {
      c.release();
    }
    expect(mockState.jobs.filter((j) => j.data.callId === callId)).toEqual([]);
    const part = (await q(
      "SELECT transcript_status, job_runs FROM comms_call_recording WHERE call_id = $1 AND side = 'caller' AND part_index = 2",
      [callId],
    )).rows[0];
    expect(part).toEqual({ transcript_status: "FAILED", job_runs: 1 });
  });
});
