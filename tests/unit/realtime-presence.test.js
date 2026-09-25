"use strict";
/**
 * Presence at scale (calls audit B3, C9, D6, D8, E12, N1, N2; PR-5 step 4/7).
 *
 * Before: one tenant-wide SET of sockets that never expired (a crashed replica
 * left ghosts forever), a per-process socket counter (a user with tabs on two
 * replicas went "offline" when one closed), an online/offline broadcast to the
 * WHOLE tenant on every connect, a database write on every beat, no snapshot
 * on connect (everyone looked offline until they reconnected), channel and
 * mail rooms without the env, and a mail bridge that re-emitted once per
 * replica.
 */
jest.mock("../../src/config/redis", () => {
  const fake = require("../helpers/fake-redis").createFakeRedis();
  return { getClient: () => fake, __fake: fake };
});
jest.mock("../../src/jobs/queue-producer", () => ({ enqueue: jest.fn(async () => ({})) }));
const mockDb = { writes: 0, contacts: {} };
jest.mock("../../src/services/tenant/registry.service", () => ({
  withTenantConnection: jest.fn(async (_t, _e, fn) => fn({
    query: async (sql, params) => {
      if (/FROM comms_member me/.test(sql)) {
        return { rows: (mockDb.contacts[params[0]] || []).map((user_id) => ({ user_id })) };
      }
      if (/INSERT INTO comms_user_presence/.test(sql)) { mockDb.writes += 1; return { rows: [{}] }; }
      return { rows: [] };
    },
  })),
}));

const { EventEmitter } = require("events");
const redis = require("../../src/config/redis").__fake;
const { enqueue } = require("../../src/jobs/queue-producer");
const realtime = require("../../src/realtime");

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const TENANT = { slug: "acme", db_name: "tenant_acme" };

let emitted;
function fakeIo() {
  const make = (local) => ({
    to: (rooms) => ({
      emit: (event, payload) => emitted.push({ rooms: [].concat(rooms), event, payload, local }),
    }),
  });
  return { ...make(false), local: make(true) };
}
function fakeSocket(userId, id, env = "live") {
  const s = new EventEmitter();
  s.id = id;
  s.data = { tenant: TENANT, tenantSlug: "acme", env, userId };
  s.sent = [];
  const on = s.on.bind(s);
  s.emit = (event, payload) => { s.sent.push({ event, payload }); return true; };
  s.fire = (event, ...args) => { EventEmitter.prototype.emit.call(s, event, ...args); };
  s.on = on;
  return s;
}
const settle = () => new Promise((r) => setImmediate(r));
const flush = async () => { for (let i = 0; i < 20; i += 1) await settle(); };

beforeEach(() => {
  redis._reset();
  emitted = [];
  mockDb.writes = 0;
  mockDb.contacts = { [A]: [B], [B]: [A], [C]: [] };
  realtime.setIoForTests(fakeIo());
  enqueue.mockClear();
});
afterAll(() => realtime.setIoForTests(null));

describe("presence goes to contacts only, once per user (D6)", () => {
  test("A's first socket tells B, and nobody else, in B's own room", async () => {
    realtime.attachPresence(fakeSocket(A, "s1"));
    await flush();
    const online = emitted.filter((e) => e.event === "comms:presence");
    expect(online).toEqual([{ rooms: [`t:acme:live:u:${B}`], event: "comms:presence", payload: { user_id: A, online: true }, local: false }]);
  });

  test("a second tab (another replica) is not announced, and closing one tab does not take A offline", async () => {
    const tab1 = fakeSocket(A, "s1");
    const tab2 = fakeSocket(A, "s2");
    realtime.attachPresence(tab1);
    await flush();
    realtime.attachPresence(tab2);
    await flush();
    tab1.fire("disconnect");
    await flush();
    const events = emitted.filter((e) => e.event === "comms:presence").map((e) => e.payload.online);
    expect(events).toEqual([true]);
    tab2.fire("disconnect");
    await flush();
    expect(emitted.filter((e) => e.event === "comms:presence").map((e) => e.payload.online)).toEqual([true, false]);
  });

  test("nothing goes to the tenant-wide mail room any more", async () => {
    realtime.attachPresence(fakeSocket(A, "s1"));
    await flush();
    expect(emitted.some((e) => e.rooms.some((r) => r.endsWith(":mail")))).toBe(false);
  });
});

describe("a snapshot on connect (E12)", () => {
  test("the socket learns which of its contacts are online right now", async () => {
    realtime.attachPresence(fakeSocket(B, "b1"));
    await flush();
    const a = fakeSocket(A, "a1");
    realtime.attachPresence(a);
    await flush();
    expect(a.sent.find((x) => x.event === "comms:presence_snapshot").payload).toEqual({ users: { [B]: true } });
  });

  test("an offline contact is in the snapshot as false, so a reconnect resets a stale dot", async () => {
    const a = fakeSocket(A, "a1");
    realtime.attachPresence(a);
    await flush();
    expect(a.sent.find((x) => x.event === "comms:presence_snapshot").payload).toEqual({ users: { [B]: false } });
  });
});

describe("keys that expire (B3, D8)", () => {
  test("a socket's entry and the user's key carry a TTL", async () => {
    realtime.attachPresence(fakeSocket(A, "s1"));
    await flush();
    const ttl = await redis.pttl(`presence:acme:live:${A}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(90_000);
  });

  test("no global online SET or offline ZSET is written", async () => {
    realtime.attachPresence(fakeSocket(A, "s1"));
    await flush();
    const { sets, zsets } = redis._dump();
    expect([...sets.keys(), ...zsets.keys()].some((k) => k.startsWith("praxis:comms:online")
      || k.startsWith("praxis:comms:call-offline"))).toBe(false);
  });
});

describe("last seen is throttled on the server (C9)", () => {
  test("a flood of beats from one socket writes last_seen_at once", async () => {
    const a = fakeSocket(A, "s1");
    realtime.attachPresence(a);
    await flush();
    for (let i = 0; i < 50; i += 1) a.fire("comms:seen");
    await flush();
    expect(mockDb.writes).toBe(1);
  });

  test("reconnect storms write once per user per 5 minutes", async () => {
    for (let i = 0; i < 10; i += 1) {
      const s = fakeSocket(A, `s${i}`);
      realtime.attachPresence(s);
      await flush();
      s.fire("disconnect");
      await flush();
    }
    expect(mockDb.writes).toBe(1);
  });
});

describe("a disconnect mid-call queues that call's liveness check (D1)", () => {
  test("the last socket leaving queues a check 60 s out", async () => {
    await redis.set(`presence:call:acme:live:${A}`, "call-9");
    const s = fakeSocket(A, "s1");
    realtime.attachPresence(s);
    await flush();
    s.fire("disconnect");
    await flush();
    const job = enqueue.mock.calls.find((c) => c[0] === "comms-call-clock");
    expect(job[1]).toBe("liveness");
    expect(job[2]).toMatchObject({ callId: "call-9", env: "live" });
    expect(job[3].delay).toBeGreaterThan(59_000);
    expect(job[3].delay).toBeLessThan(61_000);
  });

  test("no call, no check", async () => {
    const s = fakeSocket(A, "s1");
    realtime.attachPresence(s);
    await flush();
    s.fire("disconnect");
    await flush();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("Redis down never breaks a socket", () => {
  test("connect and disconnect with Redis failing throw nothing", async () => {
    redis._state.fail = true;
    const s = fakeSocket(A, "s1");
    expect(() => realtime.attachPresence(s)).not.toThrow();
    await flush();
    s.fire("disconnect");
    await flush();
    redis._state.fail = false;
  });
});

describe("every room carries the env (N1)", () => {
  test("a sandbox socket joins the sandbox mail room and its sandbox user room", () => {
    const joined = [];
    realtime.joinPersonalRooms({ data: { tenantSlug: "acme", env: "sandbox", userId: A }, join: (r) => joined.push(r) });
    expect(joined).toEqual(["t:acme:sandbox:mail", `t:acme:sandbox:u:${A}`]);
  });

  test("a channel publish goes to the env's channel room only", () => {
    realtime.publish("acme", "sandbox", "g1", "message:new", { x: 1 });
    realtime.publish("acme", undefined, "g1", "message:new", { x: 1 });
    expect(emitted).toEqual([{ rooms: ["t:acme:sandbox:c:g1"], event: "message:new", payload: { x: 1 }, local: false }]);
  });

  test("presence in sandbox is announced to sandbox rooms", async () => {
    realtime.attachPresence(fakeSocket(A, "s1", "sandbox"));
    await flush();
    expect(emitted.find((e) => e.event === "comms:presence").rooms).toEqual([`t:acme:sandbox:u:${B}`]);
  });
});

describe("the mail bridge re-emits on this replica only (N2)", () => {
  test("mail:new goes out through io.local to the live mail room", () => {
    const sub = new EventEmitter();
    sub.subscribe = async () => 1;
    const redisMod = require("../../src/config/redis");
    redisMod.getSubscriber = () => sub;
    realtime.attachMailBridge();
    sub.emit("message", "mail:events", JSON.stringify({ slug: "acme", payload: { inserted: 2 } }));
    expect(emitted).toEqual([{ rooms: ["t:acme:live:mail"], event: "mail:new", payload: { inserted: 2 }, local: true }]);
  });
});

describe("a disconnect that races its own connect", () => {
  test("leaves no entry behind: the user is offline afterwards", async () => {
    const presence = require("../../src/modules/smartcomm/smartcomm.presence");
    const realJoin = presence.join;
    const spy = jest.spyOn(presence, "join").mockImplementation(async (...a) => {
      await new Promise((r) => setTimeout(r, 30)); // a slow Redis round-trip
      return realJoin(...a);
    });
    const s = fakeSocket(A, "quick");
    realtime.attachPresence(s);
    s.fire("disconnect"); // before the join has landed
    await new Promise((r) => setTimeout(r, 60));
    await flush();
    spy.mockRestore();
    expect(await redis.zcount(`presence:acme:live:${A}`, Date.now(), "+inf")).toBe(0);
  });
});
