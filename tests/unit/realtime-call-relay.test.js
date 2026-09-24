"use strict";
/**
 * Calls audit C5 and D7: the signalling relay in src/realtime/index.js.
 *
 *   C5  it relayed for calls in any status (a past participant could push SDP
 *       into the other person's client at any time), accepted payloads of any
 *       shape up to socket.io's 1 MB default, and had no rate limit.
 *   D7  every ICE candidate opened a tenant DB connection.
 *
 * The socket is a fake with the two hooks the relay uses (`on` and
 * `onAnyOutgoing`); the database is a fake that honours the status filter the
 * way Postgres would, and counts connections.
 */
const { EventEmitter } = require("events");

const mockEmits = [];
jest.mock("@socket.io/redis-emitter", () => ({
  Emitter: class {
    to(room) { return { emit: (event, payload) => mockEmits.push({ room, event, payload }) }; }
  },
}));
jest.mock("../../src/config/redis", () => ({
  getClient: () => ({}),
  createConnection: () => { throw new Error("no redis in this test"); },
}));

const CALL = "55555555-5555-5555-5555-555555555555";
const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const mockDb = { call: null, connections: 0 };
jest.mock("../../src/services/tenant/registry.service", () => ({
  withTenantConnection: async (_tenant, _env, fn) => {
    mockDb.connections += 1;
    return fn({
      query: async (sql, params) => {
        const c = mockDb.call;
        if (!c || c.call_id !== params[0] || (c.caller_id !== params[1] && c.callee_id !== params[1])) return { rows: [] };
        // The real WHERE: a statement that names the live statuses only
        // matches a live call; one that does not matches any status.
        if (/status IN \('RINGING','IN_CALL'\)/.test(sql) && !["RINGING", "IN_CALL"].includes(c.status)) return { rows: [] };
        return { rows: [{ user_id: c.caller_id === params[1] ? c.callee_id : c.caller_id }] };
      },
    });
  },
}));

const realtime = require("../../src/realtime");

function fakeSocket() {
  const s = new EventEmitter();
  s.id = "sock-1";
  s.data = { tenant: { slug: "acme" }, tenantSlug: "acme", env: "live", userId: U1 };
  s.outgoing = [];
  s.onAnyOutgoing = (fn) => s.outgoing.push(fn);
  // What socket.io does when a broadcast to this socket's room goes out.
  s.deliver = (event, payload) => s.outgoing.forEach((fn) => fn(event, payload));
  return s;
}
const flush = () => new Promise((r) => setImmediate(r));
const offersTo = (uid) => mockEmits.filter((e) => e.room === `t:acme:live:u:${uid}` && e.event === "call:offer");
const icesTo = (uid) => mockEmits.filter((e) => e.room === `t:acme:live:u:${uid}` && e.event === "call:ice");

beforeEach(() => {
  mockEmits.length = 0;
  mockDb.connections = 0;
  mockDb.call = { call_id: CALL, caller_id: U1, callee_id: U2, status: "IN_CALL" };
  realtime.resetEmitterForTests();
});

describe("C5: only a live call is relayed", () => {
  test.each(["ENDED", "FAILED", "DECLINED", "NO_ANSWER", "CANCELLED"])("a signal for a %s call is dropped", async (status) => {
    mockDb.call.status = status;
    const s = fakeSocket();
    realtime.attachCallSignals(s);
    s.emit("call:offer", { callId: CALL, sdp: "v=0" });
    await flush();
    expect(offersTo(U2)).toHaveLength(0);
  });

  test("a live call is relayed to the other participant", async () => {
    const s = fakeSocket();
    realtime.attachCallSignals(s);
    s.emit("call:offer", { callId: CALL, sdp: "v=0" });
    await flush();
    expect(offersTo(U2)).toHaveLength(1);
    expect(offersTo(U2)[0].payload).toEqual({ call_id: CALL, sdp: "v=0" });
  });

  test("once the call ends, the socket stops relaying at once (the end event clears its cache)", async () => {
    const s = fakeSocket();
    realtime.attachCallSignals(s);
    s.emit("call:ice", { callId: CALL, candidate: { candidate: "a", sdpMid: "0", sdpMLineIndex: 0 } });
    await flush();
    mockDb.call.status = "ENDED";
    s.deliver("call:ended", { call_id: CALL });
    s.emit("call:offer", { callId: CALL, sdp: "v=0" });
    await flush();
    expect(offersTo(U2)).toHaveLength(0);
  });
});

describe("D7: one tenant connection per call, not per candidate", () => {
  test("thirty candidates cost one lookup", async () => {
    const s = fakeSocket();
    realtime.attachCallSignals(s);
    for (let i = 0; i < 30; i += 1) {
      s.emit("call:ice", { callId: CALL, candidate: { candidate: `c${i}`, sdpMid: "0", sdpMLineIndex: 0 } });
      await flush();
    }
    expect(icesTo(U2)).toHaveLength(30);
    expect(mockDb.connections).toBe(1);
  });
});

describe("C5: payloads are bounded and shaped", () => {
  test("an SDP over 64 KB, or not a string, is dropped", async () => {
    const s = fakeSocket();
    realtime.attachCallSignals(s);
    s.emit("call:offer", { callId: CALL, sdp: "x".repeat(64 * 1024 + 1) });
    s.emit("call:answer", { callId: CALL, sdp: { type: "answer", sdp: "v=0" } });
    await flush();
    expect(mockEmits).toHaveLength(0);
  });

  test("a candidate over 2 KB is dropped; a good one is passed on with only its known fields", async () => {
    const s = fakeSocket();
    realtime.attachCallSignals(s);
    s.emit("call:ice", { callId: CALL, candidate: { candidate: "x".repeat(2100), sdpMid: "0" } });
    s.emit("call:ice", { callId: CALL, candidate: { candidate: "a", sdpMid: "0", sdpMLineIndex: 0, usernameFragment: "u", evil: "y".repeat(100) } });
    s.emit("call:ice", { callId: CALL, candidate: null });
    await flush();
    expect(icesTo(U2).map((e) => e.payload.candidate)).toEqual([
      { candidate: "a", sdpMid: "0", sdpMLineIndex: 0, usernameFragment: "u" },
      null,
    ]);
  });

  test("a call id that is not a uuid never reaches the database", async () => {
    const s = fakeSocket();
    realtime.attachCallSignals(s);
    s.emit("call:offer", { callId: "'; drop table", sdp: "v=0" });
    await flush();
    expect(mockDb.connections).toBe(0);
  });
});

describe("C5: a per-socket rate limit", () => {
  test("a flood is cut at the bucket; the socket recovers as it refills", async () => {
    jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick"] });
    try {
      const s = fakeSocket();
      realtime.attachCallSignals(s);
      for (let i = 0; i < 500; i += 1) s.emit("call:ice", { callId: CALL, candidate: null });
      await flush();
      const relayed = icesTo(U2).length;
      expect(relayed).toBeGreaterThan(0);
      expect(relayed).toBeLessThanOrEqual(realtime.SIGNAL_LIMITS.burst);
      jest.advanceTimersByTime(2000);
      s.emit("call:ice", { callId: CALL, candidate: null });
      await flush();
      expect(icesTo(U2).length).toBe(relayed + 1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("C5: the socket server's buffer is bounded", () => {
  test("maxHttpBufferSize is far below socket.io's 1 MB default and fits a 64 KB SDP", () => {
    const http = require("http");
    const server = http.createServer();
    const io = realtime.initSocket(server);
    try {
      expect(io.engine.opts.maxHttpBufferSize).toBeLessThanOrEqual(256 * 1024);
      expect(io.engine.opts.maxHttpBufferSize).toBeGreaterThan(64 * 1024);
    } finally {
      io.close();
      server.close();
    }
  });
});

describe("a malformed event cannot take the process down", () => {
  test.each([null, 42, "x", [1], true])("payload %p on every call event is ignored without throwing", async (payload) => {
    const s = fakeSocket();
    realtime.attachCallSignals(s);
    for (const event of ["call:offer", "call:answer", "call:ice", "call:ring_ack"]) {
      expect(() => s.emit(event, payload)).not.toThrow();
    }
    await flush();
    expect(mockEmits).toHaveLength(0);
    expect(mockDb.connections).toBe(0);
  });
});
