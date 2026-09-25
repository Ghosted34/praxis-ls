"use strict";
/**
 * Calls audit A9 and A6, the realtime half.
 *
 *   A9  The per-user room had no environment in it (`t:<slug>:u:<uid>`), so a
 *       sandbox (training) call rang and notified the same user's LIVE tabs.
 *       The room is now `t:<slug>:<env>:u:<uid>` and a socket joins its own.
 *   A6  `publishToUser` did nothing in the worker, where there is no socket
 *       server, so `call:summary_ready` never reached anyone. The worker now
 *       publishes through @socket.io/redis-emitter.
 *
 * The emitter/adapter pairing is proved without a Redis server: the REAL
 * emitter publishes into an in-memory pub/sub bus, and a REAL socket.io server
 * with the REAL redis adapter subscribes to the same bus. The test then asks
 * the adapter which sockets the message would be delivered to.
 */
const { EventEmitter } = require("events");

class FakeBus extends EventEmitter {
  constructor() {
    super();
    this.patterns = new Set();
    this.published = [];
  }
  psubscribe(pattern) {
    this.patterns.add(pattern);
    return Promise.resolve();
  }
  subscribe() {
    return Promise.resolve();
  }
  punsubscribe(pattern) {
    this.patterns.delete(pattern);
    return Promise.resolve();
  }
  unsubscribe() {
    return Promise.resolve();
  }
  publish(channel, msg) {
    this.published.push({ channel: String(channel), msg });
    for (const p of this.patterns) {
      if (String(channel).startsWith(p.replace(/\*$/, ""))) {
        this.emit("pmessageBuffer", Buffer.from(p), Buffer.from(String(channel)), Buffer.from(msg));
      }
    }
    return Promise.resolve(1);
  }
}

const mockBus = { current: null };
jest.mock("../../src/config/redis", () => ({
  getClient: () => mockBus.current,
  createConnection: () => mockBus.current,
}));

const { Server } = require("socket.io");
const { createAdapter, RedisAdapter } = require("@socket.io/redis-adapter");
const realtime = require("../../src/realtime");

const U1 = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  mockBus.current = new FakeBus();
  realtime.resetEmitterForTests();
});

describe("the user room carries the environment (A9)", () => {
  test("a socket joins the room for its own env, plus that env's mail room (N1)", () => {
    const joined = [];
    const live = { data: { tenantSlug: "acme", env: "live", userId: U1 }, join: (r) => joined.push(r) };
    realtime.joinPersonalRooms(live);
    expect(joined).toEqual(["t:acme:live:mail", `t:acme:live:u:${U1}`]);

    joined.length = 0;
    const sandbox = { data: { tenantSlug: "acme", env: "sandbox", userId: U1 }, join: (r) => joined.push(r) };
    realtime.joinPersonalRooms(sandbox);
    expect(joined).toContain(`t:acme:sandbox:u:${U1}`);
    expect(joined).not.toContain(`t:acme:live:u:${U1}`);
  });

  test("a publish with no valid env goes nowhere rather than to the live room", () => {
    realtime.publishToUser("acme", undefined, U1, "call:ringing", { call_id: "c1" });
    realtime.publishToUser("acme", "staging", U1, "call:ringing", { call_id: "c1" });
    expect(mockBus.current.published).toEqual([]);
  });
});

describe("a worker-side publish reaches the right sockets (A6 + A9)", () => {
  let io;
  let adapter;
  let delivered;

  beforeEach(async () => {
    io = new Server();
    io.adapter(createAdapter(mockBus.current, mockBus.current));
    adapter = io.of("/").adapter;
    // Two tabs of the same person: one on live, one on the training sandbox.
    adapter.addAll("sid-live", new Set([`t:acme:live:u:${U1}`]));
    adapter.addAll("sid-sandbox", new Set([`t:acme:sandbox:u:${U1}`]));
    delivered = [];
    const parent = Object.getPrototypeOf(RedisAdapter.prototype);
    // The adapter decoded the emitter's message and is about to deliver it:
    // record which sockets its rooms would reach (the sids above are not real
    // connections, so they are read from the adapter's room map).
    jest.spyOn(parent, "broadcast").mockImplementation(function capture(packet, opts) {
      const sids = [...opts.rooms].flatMap((r) => [...(this.rooms.get(r) || [])]);
      delivered.push({ event: packet.data[0], payload: packet.data[1], sids });
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    // No HTTP server was attached, so only the adapter's subscriptions to undo.
    await adapter.close();
  });

  test("the realtime module has no socket server here, exactly like the worker", () => {
    expect(realtime.isReady()).toBe(false);
  });

  test("a live publish reaches the live tab and never the sandbox tab", async () => {
    realtime.publishToUser("acme", "live", U1, "call:summary_ready", { call_id: "c1" });
    await new Promise((r) => setImmediate(r));
    expect(mockBus.current.published[0].channel).toBe(`socket.io#/#t:acme:live:u:${U1}#`);
    expect(delivered).toEqual([{ event: "call:summary_ready", payload: { call_id: "c1" }, sids: ["sid-live"] }]);
  });

  test("a sandbox publish reaches the sandbox tab and never the live tab", async () => {
    realtime.publishToUser("acme", "sandbox", U1, "call:ringing", { call_id: "c2" });
    await new Promise((r) => setImmediate(r));
    expect(delivered).toEqual([{ event: "call:ringing", payload: { call_id: "c2" }, sids: ["sid-sandbox"] }]);
  });

  test("a publish for another tenant's user room is not delivered here at all", async () => {
    realtime.publishToUser("globex", "live", U1, "call:ringing", { call_id: "c3" });
    await new Promise((r) => setImmediate(r));
    expect(delivered).toEqual([]);
  });
});
