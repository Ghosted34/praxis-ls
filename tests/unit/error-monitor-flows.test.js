"use strict";

/**
 * Error Command Center — spec §12 Testing Requirements.
 *
 * The spec names five:
 *
 *   1. Unit tests for error parsing/normalization   → error-monitor.test.js
 *   2. Integration tests for WebSocket events       → here, "WebSocket namespace"
 *   3. E2E tests for share flow                     → here, "share flow"
 *   4. AI explanation response validation           → here, "AI explanation"
 *   5. Polling fallback simulation tests            → here, "polling fallback"
 *
 * WHAT "E2E" MEANS HERE, STATED HONESTLY
 *
 *   Item 3 says end-to-end. These run the real router, the real controller, the
 *   real service and the real share/notification code — everything except the
 *   browser and the database, both of which are doubled. That is an INTEGRATION
 *   test, not a browser E2E, and calling it E2E would overstate it: nothing
 *   here proves `window.open` fires or that a mailto: handler exists.
 *
 *   Browser-level E2E for the console would need Playwright added to
 *   platform-console (the tenant `client` has it; the console does not). That
 *   is a real piece of work and it is listed as such rather than faked here.
 *
 *   The WebSocket suite drives the namespace through a socket.io Server double
 *   rather than a live wire, because `socket.io-client` is not a root
 *   dependency. The auth decisions, room membership and broadcast targeting —
 *   the parts with actual logic — are exercised directly.
 */

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const DB = require.resolve("../../src/services/platform/db");
const PLATFORM_AUTH = require.resolve("../../src/middleware/platform-auth");
const LLM = require.resolve("../../src/services/ai/llm.service");
const REDIS = require.resolve("../../src/config/redis");

const ACTOR = "11111111-1111-1111-1111-111111111111";
const ERROR_ID = "22222222-2222-2222-2222-222222222222";
const RECIPIENT = "33333333-3333-3333-3333-333333333333";

/** One error row, shaped like errors.service SELECT_COLUMNS returns it. */
const ERROR_ROW = {
  id: ERROR_ID,
  signature: "TypeError|cannot read <n>|at f (/app/src/modules/logistics/shipments/x.js)",
  tenant_id: null,
  tenant_slug: "smartlog",
  tenant_name: "SmartLog",
  level: "fatal",
  origin: "server",
  message: "Cannot read property 'id' of undefined",
  name: "TypeError",
  module: "shipments",
  route: "POST /api/shipments/assign",
  file_path: "src/modules/logistics/shipments/shipment.controller.js",
  line_number: 142,
  release: "abc123",
  env: "production",
  occurrence_count: 23,
  first_seen: new Date(Date.now() - 3 * 3600e3).toISOString(),
  last_seen: new Date().toISOString(),
  resolved_at: null,
  resolved_by: null,
  resolved_by_name: null,
  stack_trace: [{ index: 1, function: "createShipment", file: "src/x.js", line: 89, column: 4, module: "shipments", vendor: false }],
  raw_stack: "TypeError: x\n    at createShipment (/app/src/x.js:89:4)",
  context: {},
  explanation: null,
  explanation_by: null,
  explanation_at: null,
};

/**
 * Mount the REAL errors router with platformAuth doubled.
 *
 * Only the authentication step is replaced — `requireCap` is the genuine
 * article, so a route that lost its gate still fails here rather than sailing
 * through on a permissive stub.
 */
function buildApp(queryHandler, { caps = ["errors.read", "errors.resolve", "errors.configure"] } = {}) {
  jest.resetModules();
  jest.doMock(DB, () => ({ query: queryHandler }));

  const real = jest.requireActual(PLATFORM_AUTH);
  jest.doMock(PLATFORM_AUTH, () => ({
    ...real,
    platformAuth: (req, _res, next) => {
      req.platformUser = { platform_user_id: ACTOR, role: "PLATFORM_SUPPORT", email: "ops@praxisls.com" };
      req.platformCaps = new Set(caps);
      next();
    },
  }));

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.platformUser = { platform_user_id: ACTOR, role: "PLATFORM_SUPPORT" };
    req.platformCaps = new Set(caps);
    next();
  });

  app.use("/api/platform", require("../../src/modules/platform/errors/errors.routes"));

  const { errorHandler } = require("../../src/middleware/error-handler");
  app.use(errorHandler);
  return app;
}

// ═══════════════════════════════════════════════════════════════════════════
// §12.2 — WebSocket events
// ═══════════════════════════════════════════════════════════════════════════
describe("§12.2 WebSocket namespace — authentication and event routing", () => {
  /**
   * A socket.io Server double. `io.of(ns)` hands back an object that records
   * `use()` middleware and the connection handler, so the suite can drive both
   * without a wire, and records every `emit` with the room it was sent to.
   */
  function fakeIo() {
    const emitted = [];
    const ns = {
      _use: null,
      _onConnection: null,
      use(fn) { ns._use = fn; },
      on(ev, fn) { if (ev === "connection") ns._onConnection = fn; },
      to(room) { return { emit: (ev, payload) => emitted.push({ room, ev, payload }) }; },
      emit: (ev, payload) => emitted.push({ room: "*", ev, payload }),
    };
    return { io: { of: () => ns }, ns, emitted };
  }

  function fakeSocket() {
    const rooms = new Set();
    const handlers = {};
    return {
      id: "sock-1",
      rooms,
      data: {},
      handshake: { auth: {}, headers: {} },
      join: (r) => rooms.add(r),
      leave: (r) => rooms.delete(r),
      on: (ev, fn) => { handlers[ev] = fn; },
      _fire: (ev, ...args) => handlers[ev] && handlers[ev](...args),
    };
  }

  function load(queryHandler) {
    jest.resetModules();
    jest.doMock(DB, () => ({ query: queryHandler }));

    return require("../../src/realtime/platform-ns");
  }

  const SECRET = "test-secret-for-platform-ns";
  const tokenFor = (payload) => jwt.sign(payload, SECRET);

  function withSecret(queryHandler) {
    jest.resetModules();
    jest.doMock(DB, () => ({ query: queryHandler }));
    const realEnv = jest.requireActual("../../src/config/env");
    jest.doMock("../../src/config/env", () => ({
      ...realEnv,
      config: { ...realEnv.config, JWT_ACCESS_SECRET: SECRET },
    }));

    return require("../../src/realtime/platform-ns");
  }

  const ACTIVE_ADMIN = {
    platform_user_id: ACTOR, email: "a@b.cm", role: "PLATFORM_ROOT_ADMIN", is_active: true,
  };

  /** Drive the `use()` middleware and return the error it passed to next(). */
  async function authenticate(ns, token) {
    const socket = fakeSocket();
    socket.handshake.auth.token = token;
    const err = await new Promise((resolve) => ns._use(socket, resolve));
    return { socket, err };
  }

  it("rejects a TENANT token — the boundary PRD §5.3 exists to hold", async () => {
    const mod = withSecret(async () => ({ rows: [ACTIVE_ADMIN] }));
    const { ns } = fakeIo();
    mod.initPlatformNamespace({ of: () => ns });

    // typ:"access" is a tenant token. A platform namespace must never take one.
    const { err } = await authenticate(ns, tokenFor({ sub: ACTOR, typ: "access" }));
    expect(err && err.message).toBe("WRONG_AUDIENCE");
  });

  it("rejects an unsigned / garbage token", async () => {
    const mod = withSecret(async () => ({ rows: [ACTIVE_ADMIN] }));
    const { ns } = fakeIo();
    mod.initPlatformNamespace({ of: () => ns });

    const { err } = await authenticate(ns, "not-a-jwt");
    expect(err && err.message).toBe("INVALID_TOKEN");
  });

  it("rejects a deactivated user even with a valid token", async () => {
    const mod = withSecret(async () => ({ rows: [{ ...ACTIVE_ADMIN, is_active: false }] }));
    const { ns } = fakeIo();
    mod.initPlatformNamespace({ of: () => ns });

    const { err } = await authenticate(ns, tokenFor({ sub: ACTOR, typ: "platform" }));
    expect(err && err.message).toBe("USER_INACTIVE");
  });

  it("rejects a user without errors.read — the socket cannot see what HTTP refuses", async () => {
    const mod = withSecret(async (sql) => {
      if (/platform_role_permission/s.test(sql)) return { rows: [] }; // no caps
      return { rows: [{ ...ACTIVE_ADMIN, role: "PLATFORM_SUPPORT" }] };
    });
    const { ns } = fakeIo();
    mod.initPlatformNamespace({ of: () => ns });

    const { err } = await authenticate(ns, tokenFor({ sub: ACTOR, typ: "platform" }));
    expect(err && err.message).toBe("FORBIDDEN");
  });

  it("admits a root admin with no capability rows — root bypasses, as requireCap does", async () => {
    const mod = withSecret(async (sql) => {
      if (/platform_role_permission/s.test(sql)) return { rows: [] };
      return { rows: [ACTIVE_ADMIN] };
    });
    const { ns } = fakeIo();
    mod.initPlatformNamespace({ of: () => ns });

    const { socket, err } = await authenticate(ns, tokenFor({ sub: ACTOR, typ: "platform" }));
    expect(err).toBeUndefined();
    expect(socket.data.isRoot).toBe(true);
  });

  it("joins the combined feed AND a personal room on connect", async () => {
    const mod = load(async () => ({ rows: [] }));
    const { ns } = fakeIo();
    mod.initPlatformNamespace({ of: () => ns });

    const socket = fakeSocket();
    socket.data = { userId: ACTOR };
    ns._onConnection(socket);

    expect(socket.rooms.has("errors:all")).toBe(true);
    expect(socket.rooms.has(`user:${ACTOR}`)).toBe(true);
  });

  it("subscribe swaps the FEED room and keeps the personal one", async () => {
    // The regression this guards: changing the scope filter used to leave every
    // room, silently unsubscribing the user from their own notifications.
    const mod = load(async () => ({ rows: [] }));
    const { ns } = fakeIo();
    mod.initPlatformNamespace({ of: () => ns });

    const socket = fakeSocket();
    socket.data = { userId: ACTOR };
    ns._onConnection(socket);
    socket._fire("subscribe", { tenant_id: "smartlog" }, () => {});

    expect(socket.rooms.has("errors:t:smartlog")).toBe(true);
    expect(socket.rooms.has("errors:all")).toBe(false);
    expect(socket.rooms.has(`user:${ACTOR}`)).toBe(true);
  });

  it("unsubscribe also keeps the personal room", async () => {
    const mod = load(async () => ({ rows: [] }));
    const { ns } = fakeIo();
    mod.initPlatformNamespace({ of: () => ns });

    const socket = fakeSocket();
    socket.data = { userId: ACTOR };
    ns._onConnection(socket);
    socket._fire("unsubscribe");

    expect(socket.rooms.has(`user:${ACTOR}`)).toBe(true);
  });

  it("routes a tenant error to the tenant room and a platform error to the platform room", async () => {
    const mod = load(async () => ({ rows: [] }));
    const { ns, emitted } = fakeIo();
    mod.initPlatformNamespace({ of: () => ns });

    mod.broadcastError({ error_id: "e1", signature: "s1", tenant_id: "t-uuid", level: "fatal", occurrence_count: 1 });
    mod.broadcastError({ error_id: "e2", signature: "s2", tenant_id: null, level: "error", occurrence_count: 1 });

    const rooms = emitted.filter((e) => e.ev === "new_error").map((e) => e.room);
    expect(rooms.some((r) => String(r).startsWith("errors:t:"))).toBe(true);
    expect(rooms).toContain("errors:platform");
  });

  it("pushes a notification ONLY to its addressee", async () => {
    const mod = load(async () => ({ rows: [] }));
    const { ns, emitted } = fakeIo();
    mod.initPlatformNamespace({ of: () => ns });

    mod.pushNotification(RECIPIENT, { id: "n1", title: "t", body: "b" });

    const push = emitted.find((e) => e.ev === "notification");
    expect(push.room).toBe(`user:${RECIPIENT}`);
    // Never the broadcast channel: an escalation aimed at one on-call admin
    // must not reach every console.
    expect(push.room).not.toBe("*");
  });

  it("emits error_resolved so a second admin sees it disappear", async () => {
    const mod = load(async () => ({ rows: [] }));
    const { ns, emitted } = fakeIo();
    mod.initPlatformNamespace({ of: () => ns });

    mod.broadcastResolved({ id: ERROR_ID, signature: "s", resolved_by: ACTOR, resolved_at: new Date().toISOString() });
    expect(emitted.some((e) => e.ev === "error_resolved")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §12.3 — Share flow (WhatsApp, email, in-house), through the real router
// ═══════════════════════════════════════════════════════════════════════════
describe("§12.3 share flow — router → controller → service → payload", () => {
  it("returns all three channels plus the LLM-friendly block", async () => {
    const app = buildApp(async (sql) => {
      if (/INSERT INTO platform\.platform_audit/s.test(sql)) return { rows: [] };
      return { rows: [ERROR_ROW] };
    });

    const res = await request(app).get(`/api/platform/errors/${ERROR_ID}/share`).expect(200);
    const d = res.body.data;

    expect(d.whatsapp.url).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(d.email.url).toMatch(/^mailto:\?subject=/);
    expect(d.in_house.metadata.error_signature).toBe(ERROR_ROW.signature);
    expect(d.plain).toContain("shipment.controller.js:142");
    // Appendix B, and the spec's own PRAXXIS typo is NOT reproduced.
    expect(d.whatsapp.text).toContain("PRAXIS-LS");
    expect(d.whatsapp.text).not.toContain("PRAXXIS");
  });

  it("writes an audit row — §11's requirement, and the LAST chance to record a share", async () => {
    // WhatsApp and mailto leave the browser without touching the server again,
    // so if this endpoint does not record it, nothing does.
    const audited = [];
    const app = buildApp(async (sql, params) => {
      if (/INSERT INTO platform\.platform_audit/s.test(sql)) {
        audited.push(params);
        return { rows: [] };
      }
      return { rows: [ERROR_ROW] };
    });

    await request(app).get(`/api/platform/errors/${ERROR_ID}/share`).expect(200);

    expect(audited).toHaveLength(1);
    expect(audited[0][1]).toBe("error.shared");
    expect(audited[0][0]).toBe(ACTOR);
  });

  it("in-house send rebuilds the text server-side and ignores a client-supplied title", async () => {
    // A client-controlled title on a system notification is a way to put
    // arbitrary words in a colleague's alert feed with the platform's name on it.
    let inserted = null;
    const app = buildApp(async (sql, params) => {
      if (/INSERT INTO platform\.notification/s.test(sql)) {
        inserted = params;
        return { rows: [{ notification_id: "n1", to_user_id: params[0], title: params[3], body: params[4] }] };
      }
      if (/INSERT INTO platform\.platform_audit/s.test(sql)) return { rows: [] };
      return { rows: [ERROR_ROW] };
    });

    await request(app)
      .post("/api/platform/notifications")
      .send({ to_user_id: RECIPIENT, error_id: ERROR_ID, note: "please look", title: "PWNED" })
      .expect(201);

    expect(inserted[0]).toBe(RECIPIENT);
    expect(inserted[1]).toBe(ACTOR);
    expect(inserted[3]).toContain("FATAL");     // rebuilt from the error
    expect(inserted[3]).not.toContain("PWNED"); // client title discarded
    expect(inserted[4]).toContain("please look");
  });

  it("rejects a send with no recipient", async () => {
    const app = buildApp(async () => ({ rows: [ERROR_ROW] }));
    await request(app).post("/api/platform/notifications").send({ error_id: ERROR_ID }).expect(422);
  });

  it("sending is capability-gated even though reading is not", async () => {
    const app = buildApp(async () => ({ rows: [ERROR_ROW] }), { caps: [] });
    await request(app)
      .post("/api/platform/notifications")
      .send({ to_user_id: RECIPIENT, error_id: ERROR_ID })
      .expect(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §12.4 — AI explanation response validation
// ═══════════════════════════════════════════════════════════════════════════
describe("§12.4 AI explanation — validation and cache hygiene", () => {
  /**
   * `explain()` makes THREE different reads and the double has to tell them
   * apart. Returning the error row for all of them makes the
   * `error_explanation` lookup look like a cache hit, so the model is never
   * called and every assertion below reads "cached: true" — which is a broken
   * test, not a broken product. Worth stating: the first version of this suite
   * did exactly that and reported three failures against correct code.
   */
  function loadExplain({ chat, stored = null }) {
    jest.resetModules();
    const queries = [];
    jest.doMock(DB, () => ({
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (/INSERT INTO/s.test(sql)) return { rows: [] };
        if (/FROM platform\.error_explanation/s.test(sql)) return { rows: stored ? [stored] : [] };
        return { rows: [ERROR_ROW] };
      },
    }));
    jest.doMock(LLM, () => ({ chat }));
    // No Redis in unit tests — the service is documented to fall through to the
    // DB tier when it is absent, and that path must not throw.
    jest.doMock(REDIS, () => ({ getClient: () => { throw new Error("no redis"); } }));

    return { svc: require("../../src/services/platform/error-explain.service"), queries };
  }

  it("refuses to present a stub as an explanation when no vendor is configured", async () => {
    // llm.chat returns { provider: null } when nothing is set up. Storing that
    // would poison the cache with an apology and serve it back as real.
    const { svc, queries } = loadExplain({ chat: async () => ({ provider: null, text: "" }) });

    await expect(svc.explain({ errorId: ERROR_ID, actorId: ACTOR }))
      .rejects.toMatchObject({ code: "AI_UNAVAILABLE" });

    expect(queries.some((q) => /INSERT INTO platform\.error_explanation/s.test(q.sql))).toBe(false);
  });

  it("does not cache a provider failure", async () => {
    const { svc, queries } = loadExplain({
      chat: async () => { throw new Error("502 from provider"); },
    });

    await expect(svc.explain({ errorId: ERROR_ID, actorId: ACTOR })).rejects.toBeDefined();
    expect(queries.some((q) => /INSERT INTO platform\.error_explanation/s.test(q.sql))).toBe(false);
  });

  it("persists and returns a real explanation with the vendor that produced it", async () => {
    const { svc, queries } = loadExplain({
      chat: async () => ({ provider: "deepseek", model: "deepseek-chat", text: "1. What happened…" }),
    });

    const out = await svc.explain({ errorId: ERROR_ID, actorId: ACTOR });

    expect(out.explanation).toContain("What happened");
    expect(out.generated_by).toBe("deepseek");
    expect(out.cached).toBe(false);
    expect(queries.some((q) => /INSERT INTO platform\.error_explanation/s.test(q.sql))).toBe(true);
  });

  it("serves a stored explanation without calling the model again", async () => {
    let calls = 0;
    const { svc } = loadExplain({
      chat: async () => { calls += 1; return { provider: "deepseek", text: "fresh" }; },
      stored: {
        explanation: "cached text",
        generated_by: "gemini",
        model: "gemini-1.5",
        created_at: new Date().toISOString(),
      },
    });

    const out = await svc.explain({ errorId: ERROR_ID, actorId: ACTOR });

    expect(out).toMatchObject({ cached: true, source: "db", explanation: "cached text", generated_by: "gemini" });
    // The whole point of the tier: an explained signature costs nothing.
    expect(calls).toBe(0);
  });

  it("force=true regenerates, bypassing both cache tiers", async () => {
    let calls = 0;
    const { svc } = loadExplain({
      chat: async () => { calls += 1; return { provider: "deepseek", model: "deepseek-chat", text: "regenerated" }; },
      stored: { explanation: "stale", generated_by: "gemini", model: "g", created_at: new Date().toISOString() },
    });

    const out = await svc.explain({ errorId: ERROR_ID, actorId: ACTOR, force: true });

    expect(calls).toBe(1);
    expect(out.explanation).toBe("regenerated");
    expect(out.cached).toBe(false);
  });

  it("404s on an unknown error id before spending a model call", async () => {
    let calls = 0;
    jest.resetModules();
    jest.doMock(DB, () => ({ query: async () => ({ rows: [] }) }));
    jest.doMock(LLM, () => ({ chat: async () => { calls += 1; return { provider: "deepseek", text: "x" }; } }));
    jest.doMock(REDIS, () => ({ getClient: () => { throw new Error("no redis"); } }));

    const svc = require("../../src/services/platform/error-explain.service");

    await expect(svc.explain({ errorId: ERROR_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(calls).toBe(0);
  });

  it("the system prompt asks for the four sections §7.1 specifies", () => {
    const { svc } = loadExplain({ chat: async () => ({ provider: "deepseek", text: "x" }) });
    for (const bit of ["What happened", "Why it happened", "responsible", "Suggested fix"]) {
      expect(svc.SYSTEM_PROMPT).toContain(bit);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §12.5 — Polling fallback
// ═══════════════════════════════════════════════════════════════════════════
describe("§12.5 polling fallback — the degraded path must not be a wider path", () => {
  it("passes the client watermark through so a poll returns only what changed", async () => {
    let captured = null;
    const app = buildApp(async (sql, params) => {
      captured = { sql, params };
      return { rows: [ERROR_ROW] };
    });

    const since = "2026-08-08T10:00:00.000Z";
    const res = await request(app).get(`/api/platform/errors/recent?since=${encodeURIComponent(since)}`).expect(200);

    expect(captured.params[0]).toBe(since);
    expect(captured.sql).toMatch(/last_seen > COALESCE/);
    // The next watermark is the SERVER's clock, never the browser's — a skewed
    // client clock would otherwise skip errors silently.
    expect(res.body.data.server_time).toBeDefined();
  });

  it("falls back to a short lookback on the first poll rather than the whole table", async () => {
    let captured = null;
    const app = buildApp(async (sql, params) => {
      captured = { sql, params };
      return { rows: [] };
    });

    await request(app).get("/api/platform/errors/recent").expect(200);

    expect(captured.params[0]).toBeNull();
    expect(captured.sql).toMatch(/interval '5 minutes'/);
  });

  it("honours scope — polling must not leak a wider view than the socket allowed", async () => {
    let captured = null;
    const app = buildApp(async (sql, params) => {
      captured = { sql, params };
      return { rows: [] };
    });

    await request(app).get("/api/platform/errors/recent?scope=platform").expect(200);
    expect(captured.sql).toMatch(/e\.tenant_id IS NULL/);

    await request(app).get("/api/platform/errors/recent?tenant=smartlog").expect(200);
    expect(captured.sql).toMatch(/t\.slug = \$/);
    expect(captured.params).toContain("smartlog");
  });

  it("clamps the page size a caller can ask for", async () => {
    const app = buildApp(async () => ({ rows: [] }));
    // The validator caps it; an unbounded poll during an incident is a way to
    // turn a degraded transport into a second outage.
    await request(app).get("/api/platform/errors/recent?limit=100000").expect(422);
  });
});
