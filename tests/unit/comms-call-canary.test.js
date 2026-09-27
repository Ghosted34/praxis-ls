"use strict";
/**
 * The daily platform call check (calls audit PR-7, O5): it writes one run to
 * the platform table, turns red on each shared failure and on a stuck tenant,
 * and rings the console bell once when it starts failing and once when it
 * recovers — not every day of the same outage. Nothing here touches a tenant
 * app.
 */
jest.mock("../../src/services/platform/turn-probe", () => ({ allocate: jest.fn() }));
jest.mock("../../src/config/env", () => {
  const real = jest.requireActual("../../src/config/env");
  return { ...real, config: { ...real.config, TURN_HOST: "turn.example.test", TURN_CREDENTIAL_SECRET: "s", TURN_PORT_UDP: 3478 } };
});

const probe = require("../../src/services/platform/turn-probe");
const canary = require("../../src/services/platform/comms-call-canary.service");

const DAYTIME = [{ key: "k", pattern: "0 10 * * *", tz: "Africa/Douala", next: Date.UTC(2026, 8, 26, 9, 0) }];

function platform(previous = null) {
  const rows = [];
  return {
    rows,
    query: jest.fn(async (sql, params) => {
      if (/SELECT status FROM platform.comms_call_canary_run/.test(sql)) return { rows: previous ? [{ status: previous }] : [] };
      if (/INSERT INTO platform.comms_call_canary_run/.test(sql)) {
        rows.push({ status: params[1], checks: JSON.parse(params[2]), tenant_checks: JSON.parse(params[3]), summary: params[4] });
        return { rows: [{ run_id: "c1", status: params[1] }] };
      }
      throw new Error(`unexpected ${sql.slice(0, 60)}`);
    }),
  };
}

const okProviders = async () => [
  { key: "groq", label: "Transcription via Groq", ok: true, ms: 800, error: null },
  { key: "gemini_transcribe", label: "Transcription via Gemini (forced)", ok: true, ms: 1200, error: null },
  { key: "gemini_summary", label: "Summary via Gemini", ok: true, ms: 900, error: null },
  { key: "deepseek_summary", label: "Summary via DeepSeek (forced)", ok: true, ms: 1500, error: null },
];

function deps(over = {}) {
  const tenantClient = { query: jest.fn(async () => ({ rows: [{ ringing: 0, live: 0, processing: 0 }] })) };
  return {
    job: { timestamp: Date.now() - 2000, opts: {} },
    platform: platform(over.previous || "PASSED"),
    redis: { call: jest.fn(async () => ["socket.io#/#", 2]) },
    getQueue: () => ({ getRepeatableJobs: async () => DAYTIME }),
    providers: okProviders,
    relay: async () => ({ ok: true, detail: { relayed: "203.0.113.9:50000" } }),
    listTenants: async () => [{ slug: "acme", sandbox_schema: "sandbox" }, { slug: "beta" }],
    withTenant: (_t, _env, fn) => fn(tenantClient),
    notify: jest.fn(async () => {}),
    raise: jest.fn(async () => {}),
    tenantClient,
    ...over,
  };
}

describe("the shared checks", () => {
  test("the queue check passes on time and fails when the job ran late", () => {
    const now = Date.now();
    expect(canary.queueCheck({ timestamp: now - 5000, opts: {} }, now).ok).toBe(true);
    expect(canary.queueCheck({ timestamp: now - 120000, opts: {} }, now)).toMatchObject({ ok: false });
    // A delayed job is due at timestamp + delay, not at its creation.
    expect(canary.queueCheck({ timestamp: now - 120000, opts: { delay: 118000 } }, now).ok).toBe(true);
  });

  test("the signal check fails when no API instance listens for the worker's events", async () => {
    expect((await canary.signalCheck({ call: async () => ["socket.io#/#", 0] })).ok).toBe(false);
    expect((await canary.signalCheck({ call: async () => ["socket.io#/#", 3] })).ok).toBe(true);
  });

  test("the relay check names a secret mismatch", async () => {
    probe.allocate.mockResolvedValueOnce({ ok: false, code: 401, error: "401 Unauthorized" });
    expect(await canary.relayCheck()).toMatchObject({ ok: false, error: expect.stringMatching(/TURN_CREDENTIAL_SECRET does not match/) });
    probe.allocate.mockResolvedValueOnce({ ok: true, relayed: "203.0.113.9:50000" });
    expect(await canary.relayCheck()).toMatchObject({ ok: true });
    // The credential is minted the way the API mints a caller's: expiry:token.
    expect(probe.allocate.mock.calls[1][0]).toMatchObject({ host: "turn.example.test", port: 3478, label: expect.stringMatching(/^\d+:canary-/), mac: expect.any(String) });
  });

  test("the schedule check fails on a midnight repeatable", async () => {
    const out = await canary.scheduleCheck(() => ({ getRepeatableJobs: async () => [{ key: "m", every: 86400000 }] }));
    expect(out.ok).toBe(false);
  });
});

describe("a run", () => {
  test("all green: one PASSED row, every tenant environment checked, no bell", async () => {
    const d = deps();
    const out = await canary.run(d);
    expect(out.status).toBe("PASSED");
    expect(d.platform.rows[0].checks.map((c) => c.key)).toEqual([
      "queue", "signals", "schedules", "groq", "gemini_transcribe", "gemini_summary", "deepseek_summary", "relay",
    ]);
    expect(d.platform.rows[0].tenant_checks.map((t) => `${t.slug}/${t.env}`)).toEqual(["acme/live", "acme/sandbox", "beta/live"]);
    expect(d.notify).not.toHaveBeenCalled();
    expect(d.raise).not.toHaveBeenCalled();
  });

  test("a failing provider after a green day: FAILED, one bell and one notify-level alert naming it", async () => {
    const d = deps({ providers: async () => (await okProviders()).map((c) => (c.key === "gemini_summary" ? { ...c, ok: false, error: "403 API key not valid" } : c)) });
    const out = await canary.run(d);
    expect(out.status).toBe("FAILED");
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.notify.mock.calls[0][0]).toMatchObject({ title: "Calls pipeline check failed", body: expect.stringMatching(/Summary via Gemini: 403/) });
    expect(d.raise).toHaveBeenCalledWith(expect.objectContaining({ event: "comms.call_canary", severity: "notify" }));
  });

  test("a second failing day stays quiet on the bell", async () => {
    const d = deps({ previous: "FAILED", relay: async () => ({ ok: false, error: "no answer" }) });
    expect((await canary.run(d)).status).toBe("FAILED");
    expect(d.notify).not.toHaveBeenCalled();
  });

  test("the first green day after a failure rings once to say it recovered", async () => {
    const d = deps({ previous: "FAILED" });
    expect((await canary.run(d)).status).toBe("PASSED");
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.notify.mock.calls[0][0].title).toBe("Calls pipeline check recovered");
  });

  test("a tenant with a call stuck past its deadline, or a database that does not answer, fails the run", async () => {
    const d = deps({
      withTenant: async (t, env, fn) => {
        if (t.slug === "beta") throw new Error("connect ECONNREFUSED");
        return fn({ query: async () => ({ rows: [{ ringing: 1, live: 0, processing: 2 }] }) });
      },
    });
    const out = await canary.run(d);
    expect(out.status).toBe("FAILED");
    const beta = out.tenant_checks.find((t) => t.slug === "beta");
    expect(beta.problems[0]).toMatch(/database unreachable/);
    const acme = out.tenant_checks.find((t) => t.slug === "acme" && t.env === "live");
    expect(acme.problems).toEqual(["1 call(s) ringing past the ring window", "2 transcript(s) in PROCESSING for over an hour"]);
    // Every shared check still passed: the tenants are named, not the pipeline.
    expect(out.checks.every((c) => c.ok)).toBe(true);
  });

  test("the per-tenant read spends no provider credit: one bounded SELECT on comms_call", async () => {
    const d = deps();
    await canary.run(d);
    const sqls = d.tenantClient.query.mock.calls.map((c) => c[0]);
    expect(sqls.every((s) => /^\s*SELECT/.test(s) && /FROM comms_call\s/.test(s))).toBe(true);
  });
});
