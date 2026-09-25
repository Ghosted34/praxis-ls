"use strict";
/**
 * Smart Comms Calls (PR-1) — the state machine and the sweep, against a fake
 * client that emulates the two things only Postgres can guarantee: the
 * partial unique indexes (one active call per user → 23505) and the guarded
 * UPDATE (a transition that no longer matches its fromStatus returns 0 rows).
 * Everything else in this test is plain data.
 */
const requestContext = require("../../src/config/request-context");
const realtime = require("../../src/realtime");
// PR-4: createCall queues the ring push, and ringPush / ringCancel push.
// Both are mocked: this suite is about the service's decisions (who is
// pushed, which claim wins, when it stops), not about BullMQ or a push service.
jest.mock("../../src/jobs/queue-producer", () => ({ enqueue: jest.fn(async () => ({})) }));
jest.mock("../../src/shared/push/push.service", () => ({
  sendToUser: jest.fn(async () => ({ sent: 1, failed: 0, total: 1 })),
}));
// Presence, the active-tenant set and the live-call keys are in Redis
// (PR-5). An in-memory Redis stands in; a test seeds "who has been gone since
// when" directly, which is exactly what liveness is allowed to believe.
jest.mock("../../src/config/redis", () => {
  const fake = require("../helpers/fake-redis").createFakeRedis();
  return { getClient: () => fake, __fake: fake };
});
const mockRedis = require("../../src/config/redis").__fake;
const service = require("../../src/modules/smartcomm/smartcomm.call.service");

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const U3 = "44444444-4444-4444-4444-444444444444";
const G1 = "33333333-3333-3333-3333-333333333333";

/** In-memory comms_call table with the two real guards. */
function makeStore() {
  const calls = new Map();
  let seq = 0;
  return {
    calls,
    insert({ groupId, callerId, calleeId }) {
      // Partial unique indexes: one ACTIVE call per user, either role.
      const busy = [...calls.values()].find(
        (c) => ["RINGING", "IN_CALL"].includes(c.status) &&
          (c.caller_id === callerId || c.callee_id === callerId ||
           c.caller_id === calleeId || c.callee_id === calleeId),
      );
      if (busy) {
        const err = new Error('duplicate key value violates unique constraint "uq_comms_call_one_active_caller"');
        err.code = "23505";
        throw err;
      }
      const row = {
        call_id: `call-${++seq}`,
        group_id: groupId,
        caller_id: callerId,
        callee_id: calleeId,
        status: "RINGING",
        started_at: new Date().toISOString(),
        connected_at: null,
        ended_at: null,
        duration_seconds: null,
        end_reason: null,
        ring_ack_channel: null,
        ring_ack_at: null,
        ring_push_sent_at: null,
      };
      calls.set(row.call_id, row);
      return row;
    },
    transition(callId, fromStatus, fields) {
      // The guarded UPDATE: 0 rows when the row moved on.
      const row = calls.get(callId);
      if (!row || row.status !== fromStatus) return null;
      Object.assign(row, { status: fields.status, ...fields });
      return row;
    },
  };
}

/**
 * Fake client. `groupKind` selects whether G1 is a DIRECT channel with U2 as
 * the other member; `activeCallSelects` counts findActiveCall answers so a
 * test can model the pre-check/insert race.
 */
function makeClient({ store, members = [], groupKind = "DIRECT" } = {}) {
  const counters = { activeCall: 0 };
  return {
    query: async (sql, params = []) => {
      if (/FROM comms_member WHERE group_id/.test(sql)) {
        const [groupId, userId] = params;
        const m = members.find((x) => x.group_id === groupId && x.user_id === userId);
        return { rows: m ? [m] : [] };
      }
      if (/FROM comms_group g\s+JOIN comms_member m/.test(sql)) {
        const [groupId, userId] = params;
        if (groupId !== G1 || userId !== U1 || groupKind !== "DIRECT") return { rows: [] };
        return { rows: [{ user_id: U2 }] };
      }
      if (/SELECT \* FROM comms_call\s+WHERE \(caller_id = \$1 OR callee_id = \$1\) AND status IN/.test(sql)) {
        counters.activeCall += 1;
        if (counters.activeCall <= (thisSkipActiveLookup || 0)) return { rows: [] };
        const u = params[0];
        const row = [...store.calls.values()].find(
          (c) => (c.caller_id === u || c.callee_id === u) && ["RINGING", "IN_CALL"].includes(c.status),
        );
        return { rows: row ? [row] : [] };
      }
      if (/INSERT INTO comms_call/.test(sql)) {
        const [groupId, callerId, calleeId] = params;
        return { rows: [store.insert({ groupId, callerId, calleeId })] };
      }
      if (/SET turn_token = COALESCE\(turn_token, \$2\)/.test(sql)) {
        // PR-3 (C2): the call's relay token, only while the call is live.
        const row = store.calls.get(params[0]);
        if (!row || !["RINGING", "IN_CALL"].includes(row.status)) return { rows: [] };
        row.turn_token = row.turn_token || params[1];
        return { rows: [{ turn_token: row.turn_token }] };
      }
      if (/UPDATE comms_call SET/.test(sql)) {
        const [callId, fromStatus, status] = params;
        const setClause = sql.split("SET ")[1].split(" WHERE")[0];
        const fields = { status };
        for (const part of setClause.split(",").map((s) => s.trim())) {
          const m = part.match(/^(\w+) = \$(\d+)$/);
          if (m) fields[m[1]] = params[Number(m[2]) - 1];
        }
        const updated = store.transition(callId, fromStatus, fields);
        return { rows: updated ? [updated] : [] };
      }
      // ── PR-3: the two ring claims, both guarded UPDATEs ────────────────
      if (/UPDATE comms_call\s+SET ring_ack_channel = \$2/.test(sql)) {
        const [callId, channel] = params;
        const row = store.calls.get(callId);
        if (!row || row.ring_ack_at) return { rows: [] };
        Object.assign(row, { ring_ack_channel: channel, ring_ack_at: new Date().toISOString() });
        return { rows: [row] };
      }
      if (/UPDATE comms_call\s+SET ring_alerts = \$2 \+ 1/.test(sql)) {
        // PR-4: one claim per alert number, only while the row rings.
        const [callId, alert] = params;
        const row = store.calls.get(callId);
        if (!row || row.status !== "RINGING" || (row.ring_alerts || 0) !== alert) return { rows: [] };
        row.ring_alerts = alert + 1;
        row.ring_push_sent_at = row.ring_push_sent_at || new Date().toISOString();
        return { rows: [row] };
      }
      if (/SELECT \* FROM comms_call WHERE call_id = \$1/.test(sql)) {
        const row = store.calls.get(params[0]);
        return { rows: row ? [row] : [] };
      }
      if (/SELECT 1 AS ok FROM comms_call/.test(sql)) {
        const [callId, userId] = params;
        const row = store.calls.get(callId);
        return { rows: row && (row.caller_id === userId || row.callee_id === userId) ? [{ ok: 1 }] : [] };
      }
      if (/CASE WHEN caller_id = \$2 THEN callee_id/.test(sql)) {
        const [callId, userId] = params;
        const row = store.calls.get(callId);
        if (!row || (row.caller_id !== userId && row.callee_id !== userId)) return { rows: [] };
        return { rows: [{ user_id: row.caller_id === userId ? row.callee_id : row.caller_id }] };
      }
      if (/SELECT call_id, caller_id, callee_id, status FROM comms_call WHERE status IN \('RINGING','IN_CALL'\)/.test(sql)) {
        // The safety sweep's live-row scan: liveness for IN_CALL, and the
        // count that lets the scheduler drop an idle tenant.
        return {
          rows: [...store.calls.values()].filter((c) => ["RINGING", "IN_CALL"].includes(c.status)).map((c) => ({
            call_id: c.call_id,
            caller_id: c.caller_id,
            callee_id: c.callee_id,
            status: c.status,
          })),
        };
      }
      if (/FROM comms_call\s+WHERE \(status = 'RINGING' AND started_at/.test(sql)) {
        // The sweep's due query, run against the same clock the SQL uses.
        const now = Date.now();
        return {
          rows: [...store.calls.values()].filter((c) =>
            (c.status === "RINGING" && now - Date.parse(c.started_at) > 60_000) ||
            (c.status === "IN_CALL" && c.connected_at && now - Date.parse(c.connected_at) > 1_800_000),
          ),
        };
      }
      if (/FROM app_user/.test(sql)) {
        return { rows: params[0] ? [{ user_id: params[0] }] : [] };
      }
      return { rows: [] };
    },
  };
}

let thisSkipActiveLookup = 0;
const MEMBER1 = { group_id: G1, user_id: U1 };
const TENANT = { slug: "acme", db_name: "tenant_acme" };
let publishSpy;

beforeEach(() => {
  thisSkipActiveLookup = 0;
  mockRedis._reset();
  publishSpy = jest.spyOn(realtime, "publishToUser").mockImplementation(() => {});
  require("../../src/jobs/queue-producer").enqueue.mockClear();
  require("../../src/shared/push/push.service").sendToUser.mockClear();
});
afterEach(() => {
  publishSpy.mockRestore();
});

const inTenant = (fn) => requestContext.run({ tenant: "acme", userId: U1 }, fn);

describe("dial (createCall)", () => {
  test("a non-member cannot dial the channel", async () => {
    const store = makeStore();
    await expect(
      inTenant(() => service.createCall(makeClient({ store, members: [] }), { groupId: G1, actor: { user_id: U1 } })),
    ).rejects.toThrow(/not a member/i);
  });

  test("a group channel has no partner, so the icon does not render there", async () => {
    const store = makeStore();
    await expect(
      inTenant(() => service.createCall(makeClient({ store, members: [MEMBER1], groupKind: "GROUP" }), { groupId: G1, actor: { user_id: U1 } })),
    ).rejects.toThrow(/direct conversations/i);
  });

  test("a caller already on a call gets a named busy error", async () => {
    const store = makeStore();
    store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    await expect(
      inTenant(() => service.createCall(makeClient({ store, members: [MEMBER1] }), { groupId: G1, actor: { user_id: U1 } })),
    ).rejects.toThrow(/already on a call/i);
  });

  test("a busy CALLEE is named too — the error says which end is taken", async () => {
    // U2 is already talking to U3 (NOT U1): U1 is free, U2 is not.
    const store = makeStore();
    store.insert({ groupId: G1, callerId: U2, calleeId: U3 });
    await expect(
      inTenant(() => service.createCall(makeClient({ store, members: [MEMBER1] }), { groupId: G1, actor: { user_id: U1 } })),
    ).rejects.toThrow(/that person is already on a call/i);
  });

  test("the pre-check can race the insert: the 23505 branch names the busy end", async () => {
    // The pre-check SELECTs answer "free" (the racer has not written yet),
    // then the partial unique index rejects the insert, and the resolution
    // SELECT finds the racer's row: U2 talking to U3, so U1's DIAL was the
    // one rejected for a busy callee.
    const store = makeStore();
    const racing = store.insert({ groupId: G1, callerId: U2, calleeId: U3 });
    thisSkipActiveLookup = 2; // both pre-checks lie "free" once
    await expect(
      inTenant(() => service.createCall(makeClient({ store, members: [MEMBER1] }), { groupId: G1, actor: { user_id: U1 } })),
    ).rejects.toThrow(/that person is already on a call/i);
    expect(store.calls.get(racing.call_id).status).toBe("RINGING");
  });

  test("a clean dial writes RINGING, rings the callee, and carries the caller's ICE", async () => {
    const store = makeStore();
    const result = await inTenant(() =>
      service.createCall(makeClient({ store, members: [MEMBER1] }), { groupId: G1, actor: { user_id: U1 } }),
    );
    expect(result.status).toBe("RINGING");
    expect(result.caller_id).toBe(U1);
    expect(result.callee_id).toBe(U2);
    expect(Array.isArray(result.ice.iceServers)).toBe(true);
    const toCallee = publishSpy.mock.calls.find((c) => c[2] === U2 && c[3] === "call:ringing");
    expect(toCallee).toBeTruthy();
    expect(toCallee[0]).toBe("acme");
    expect(toCallee[1]).toBe("live");
    expect(toCallee[4].call_id).toBe(result.call_id);
    const toCaller = publishSpy.mock.calls.find((c) => c[2] === U1 && c[3] === "call:ringing_sent");
    expect(toCaller).toBeTruthy();
  });
});

describe("sandbox calls stay in the sandbox (A9)", () => {
  test("a sandbox dial rings only the callee's sandbox room", async () => {
    const store = makeStore();
    await requestContext.run({ tenant: "acme", userId: U1, env: "sandbox" }, () =>
      service.createCall(makeClient({ store, members: [MEMBER1] }), { groupId: G1, actor: { user_id: U1 }, env: "sandbox" }),
    );
    const rings = publishSpy.mock.calls.filter((c) => c[3] === "call:ringing");
    expect(rings).toHaveLength(1);
    expect(rings[0].slice(0, 3)).toEqual(["acme", "sandbox", U2]);
  });

  test("the worker's sweep ends a sandbox call in the sandbox rooms", async () => {
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    call.started_at = new Date(Date.now() - 61_000).toISOString();
    await service.sweep(makeClient({ store }), { tenantSlug: "acme", env: "sandbox" });
    const ends = publishSpy.mock.calls.filter((c) => c[3] === "call:no_answer");
    expect(ends.map((c) => c[1])).toEqual(["sandbox", "sandbox"]);
  });
});

describe("answer (acceptCall)", () => {
  async function ringing() {
    const store = makeStore();
    const call = await inTenant(() =>
      service.createCall(makeClient({ store, members: [MEMBER1] }), { groupId: G1, actor: { user_id: U1 } }),
    );
    return { store, call };
  }

  test("the caller cannot answer their own call", async () => {
    const { store, call } = await ringing();
    await expect(
      inTenant(() => service.acceptCall(makeClient({ store, members: [MEMBER1] }), { id: call.call_id, actor: { user_id: U1 } })),
    ).rejects.toThrow(/cannot answer/i);
  });

  test("a stranger cannot answer", async () => {
    const { store, call } = await ringing();
    await expect(
      inTenant(() => service.acceptCall(makeClient({ store }), { id: call.call_id, actor: { user_id: "99999999-9999-9999-9999-999999999999" } })),
    ).rejects.toThrow(/not found/i);
  });

  test("the callee answers: IN_CALL with connected_at, both ends told", async () => {
    const { store, call } = await ringing();
    const updated = await inTenant(() =>
      service.acceptCall(makeClient({ store }), { id: call.call_id, actor: { user_id: U2 } }),
    );
    expect(updated.status).toBe("IN_CALL");
    expect(updated.connected_at).toBeTruthy();
    expect(publishSpy.mock.calls.filter((c) => c[3] === "call:accepted")).toHaveLength(2);
  });

  test("a ring that timed out cannot be answered after", async () => {
    const { store, call } = await ringing();
    store.transition(call.call_id, "RINGING", { status: "NO_ANSWER", end_reason: "no_answer" });
    await expect(
      inTenant(() => service.acceptCall(makeClient({ store }), { id: call.call_id, actor: { user_id: U2 } })),
    ).rejects.toThrow(/already ended/i);
  });
});

describe("hang-up and decline", () => {
  async function ringing() {
    const store = makeStore();
    const call = await inTenant(() =>
      service.createCall(makeClient({ store, members: [MEMBER1] }), { groupId: G1, actor: { user_id: U1 } }),
    );
    return { store, call };
  }

  test("the caller giving up mid-ring is a CANCELLED", async () => {
    const { store, call } = await ringing();
    const updated = await inTenant(() =>
      service.hangup(makeClient({ store }), { id: call.call_id, actor: { user_id: U1 } }),
    );
    expect(updated.status).toBe("CANCELLED");
    expect(updated.end_reason).toBe("cancelled");
    expect(publishSpy.mock.calls.some((c) => c[3] === "call:cancelled")).toBe(true);
  });

  test("the callee hanging up mid-ring is a DECLINED", async () => {
    const { store, call } = await ringing();
    const updated = await inTenant(() =>
      service.hangup(makeClient({ store }), { id: call.call_id, actor: { user_id: U2 } }),
    );
    expect(updated.status).toBe("DECLINED");
    expect(updated.end_reason).toBe("declined");
    expect(publishSpy.mock.calls.some((c) => c[3] === "call:declined")).toBe(true);
  });

  test("a call in progress ends with a measured duration", async () => {
    const { store, call } = await ringing();
    await inTenant(() => service.acceptCall(makeClient({ store }), { id: call.call_id, actor: { user_id: U2 } }));
    const row = store.calls.get(call.call_id);
    row.connected_at = new Date(Date.now() - 41 * 1000).toISOString();
    const updated = await inTenant(() =>
      service.hangup(makeClient({ store }), { id: call.call_id, actor: { user_id: U1 } }),
    );
    expect(updated.status).toBe("ENDED");
    expect(updated.end_reason).toBe("hangup");
    expect(updated.duration_seconds).toBe(41);
    expect(publishSpy.mock.calls.filter((c) => c[3] === "call:ended")).toHaveLength(2);
  });

  test("a client-claimed max_duration after 10 s records 10 s, not the 30-minute cap (B10)", async () => {
    // The end reason still comes from the request body until PR-3 (B9), so the
    // duration must never be derived from it.
    const { store, call } = await ringing();
    await inTenant(() => service.acceptCall(makeClient({ store }), { id: call.call_id, actor: { user_id: U2 } }));
    store.calls.get(call.call_id).connected_at = new Date(Date.now() - 10 * 1000).toISOString();
    const updated = await inTenant(() =>
      service.hangup(makeClient({ store }), { id: call.call_id, actor: { user_id: U1 }, reason: "max_duration" }),
    );
    expect(updated.duration_seconds).toBe(10);
  });

  test("a second hang-up loses the race and says so (409)", async () => {
    const { store, call } = await ringing();
    await inTenant(() => service.hangup(makeClient({ store }), { id: call.call_id, actor: { user_id: U1 } }));
    await expect(
      inTenant(() => service.hangup(makeClient({ store }), { id: call.call_id, actor: { user_id: U2 } })),
    ).rejects.toThrow(/already ended/i);
  });
});

describe("engine failure (reportFailure)", () => {
  test("ICE exhausted while ringing is a FAILED(ice_failed)", async () => {
    const store = makeStore();
    const call = await inTenant(() =>
      service.createCall(makeClient({ store, members: [MEMBER1] }), { groupId: G1, actor: { user_id: U1 } }),
    );
    const updated = await inTenant(() =>
      service.reportFailure(makeClient({ store }), { id: call.call_id, actor: { user_id: U1 } }),
    );
    expect(updated.status).toBe("FAILED");
    expect(updated.end_reason).toBe("ice_failed");
  });

  test("a finished call cannot be reported failed afterwards", async () => {
    const store = makeStore();
    const call = await inTenant(() =>
      service.createCall(makeClient({ store, members: [MEMBER1] }), { groupId: G1, actor: { user_id: U1 } }),
    );
    store.transition(call.call_id, "RINGING", { status: "CANCELLED", end_reason: "cancelled" });
    await expect(
      inTenant(() => service.reportFailure(makeClient({ store }), { id: call.call_id, actor: { user_id: U1 } })),
    ).rejects.toThrow(/already ended/i);
  });
});

describe("the safety sweep", () => {
  test("a ring older than 60 s becomes NO_ANSWER", async () => {
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    call.started_at = new Date(Date.now() - 61_000).toISOString();
    const { moved } = await service.sweep(makeClient({ store }), { tenantSlug: "acme" });
    expect(moved).toBe(1);
    expect(store.calls.get(call.call_id).status).toBe("NO_ANSWER");
    expect(store.calls.get(call.call_id).end_reason).toBe("no_answer");
  });

  test("a call older than 30 minutes ends at the cap, duration pinned to 1800", async () => {
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    call.started_at = new Date(Date.now() - 2_000_000).toISOString();
    call.status = "IN_CALL";
    call.connected_at = new Date(Date.now() - 1_801_000).toISOString();
    const { moved } = await service.sweep(makeClient({ store }), { tenantSlug: "acme" });
    expect(moved).toBe(1);
    const row = store.calls.get(call.call_id);
    expect(row.status).toBe("ENDED");
    expect(row.end_reason).toBe("max_duration");
    expect(row.duration_seconds).toBe(1800);
    // The worker has no ambient tenant: the job's slug must reach the publish.
    const ended = publishSpy.mock.calls.find((c) => c[3] === "call:ended" && c[2] === U1);
    expect(ended).toBeTruthy();
    expect(ended[0]).toBe("acme");
    expect(ended[4].reason).toBe("max_duration");
  });

  test("fresh calls are nobody's business", async () => {
    const store = makeStore();
    store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    const { moved } = await service.sweep(makeClient({ store }), { tenantSlug: "acme" });
    expect(moved).toBe(0);
  });

  test("a sweep that races a real hang-up loses silently", async () => {
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    call.started_at = new Date(Date.now() - 61_000).toISOString();
    // Between the sweep's SELECT and its guarded UPDATE, the caller gave up.
    const realTransition = store.transition.bind(store);
    store.transition = () => {
      if (call.status === "RINGING") {
        Object.assign(call, { status: "CANCELLED", end_reason: "cancelled" });
        return null; // our guarded UPDATE matches nothing
      }
      return realTransition(...arguments);
    };
    const { moved } = await service.sweep(makeClient({ store }), { tenantSlug: "acme" });
    expect(moved).toBe(0);
    expect(call.status).toBe("CANCELLED");
  });
});

describe("reads and TURN refresh", () => {
  test("a stranger cannot read the call", async () => {
    const store = makeStore();
    store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    const id = [...store.calls.values()][0].call_id;
    await expect(
      inTenant(() => service.getCall(makeClient({ store }), { id, actor: { user_id: "99999999-9999-9999-9999-999999999999" } })),
    ).rejects.toThrow(/not found/i);
  });

  test("a participant of a live call gets ICE config; the credential names the call, not the user", async () => {
    // The credential's shape is proved in smartcomm-call-hardening.test.js
    // (C2); here, only that the refresh works from the ordinary state machine.
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    const ice = await inTenant(() =>
      service.turnFor(makeClient({ store }), { id: call.call_id, actor: { user_id: U2 } }),
    );
    expect(Array.isArray(ice.iceServers)).toBe(true);
    expect(JSON.stringify(ice)).not.toContain(U2);
    expect(store.calls.get(call.call_id).turn_token).toBeTruthy();
  });

  test("a stranger's TURN refresh is a 404, not a credential", async () => {
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    await expect(
      inTenant(() => service.turnFor(makeClient({ store }), { id: call.call_id, actor: { user_id: "99999999-9999-9999-9999-999999999999" } })),
    ).rejects.toThrow(/not found/i);
  });
});

/**
 * PR-4 (O4; audit A7, A12, A14): the ring goes to EVERY device of the callee
 * at once, re-alerts every 15 s while the row still rings (at most 4), and a
 * cancel push replaces it everywhere when the call is answered, declined or
 * ends. The ack is the ring-channel metric only: it silences nothing.
 */
describe("rings on every device (PR-4)", () => {
  const ringJobs = () => {
    const { enqueue } = require("../../src/jobs/queue-producer");
    return enqueue.mock.calls.filter((c) => c[0] === "comms-call-ring-escalate");
  };
  const push = () => require("../../src/shared/push/push.service").sendToUser;

  test("a dial pushes the ring at once — no wait for an ack — keyed on the call and alert 0", async () => {
    const store = makeStore();
    await inTenant(() =>
      service.createCall(makeClient({ store, members: [MEMBER1] }), {
        groupId: G1, actor: { user_id: U1 }, tenantMeta: TENANT,
      }),
    );
    const jobs = ringJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0][1]).toBe("ring");
    expect(jobs[0][2]).toMatchObject({ callId: "call-1", alert: 0 });
    expect(jobs[0][3].jobId).toBe("callring-call-1-0");
    expect(jobs[0][3].delay || 0).toBe(0);
  });

  test("the ring push is a ring: high urgency, TTL = the time left, sticky, renotify, vibrate, Answer/Decline", async () => {
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    call.started_at = new Date(Date.now() - 20_000).toISOString();
    const out = await service.ringPush(makeClient({ store }), { callId: call.call_id, alert: 0, tenantMeta: TENANT });
    expect(out.pushed).toBe(true);
    const payload = push().mock.calls[0][1];
    expect(payload).toMatchObject({
      user_id: U2,
      tag: `call:${call.call_id}`,
      url: `/comms?ring=${call.call_id}`,
      urgency: "high",
      requireInteraction: true,
      renotify: true,
      vibrate: [600, 250, 600, 250, 600],
    });
    expect(payload.endpoint).toBeUndefined(); // every device, not one
    expect(payload.ttl).toBeGreaterThanOrEqual(39);
    expect(payload.ttl).toBeLessThanOrEqual(40);
    expect(payload.actions.map((a) => a.action)).toEqual(["accept", "decline"]);
    expect(payload.data).toMatchObject({ kind: "call_ring", call_id: call.call_id, group_id: G1, caller_id: U1 });
    expect(Date.parse(payload.data.expires_at)).toBe(Date.parse(call.started_at) + 60_000);
  });

  test("an ack on one device does not stop the ring on the others (A12)", async () => {
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    await service.ackRing(makeClient({ store }), { id: call.call_id, actor: { user_id: U2 }, channel: "socket", tenantSlug: "acme" });
    const out = await service.ringPush(makeClient({ store }), { callId: call.call_id, alert: 0, tenantMeta: TENANT });
    expect(out.pushed).toBe(true);
    expect(push()).toHaveBeenCalledTimes(1);
    // …and the ack is not broadcast to the callee's other devices.
    expect(publishSpy.mock.calls.find((c) => c[3] === "call:ring_ack")).toBeUndefined();
  });

  test("the ack still records the first channel, for the metric", async () => {
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    const first = await service.ackRing(makeClient({ store }), { id: call.call_id, actor: { user_id: U2 }, channel: "notification", tenantSlug: "acme" });
    expect(first.ring_ack_channel).toBe("notification");
    expect(await service.ackRing(makeClient({ store }), { id: call.call_id, actor: { user_id: U2 }, channel: "push" })).toBeNull();
    expect(await service.ackRing(makeClient({ store }), { id: call.call_id, actor: { user_id: U1 } })).toBeNull();
    await service.ackRing(makeClient({ store }), { id: store.insert({ groupId: G1, callerId: U3, calleeId: "55555555-5555-5555-5555-555555555555" }).call_id, actor: { user_id: "55555555-5555-5555-5555-555555555555" }, channel: "carrier-pigeon" });
    expect([...store.calls.values()].at(-1).ring_ack_channel).toBe("socket");
  });

  test("re-alerts every 15 s while it rings, at most 4, each sent once", async () => {
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    const client = makeClient({ store });
    await service.ringPush(client, { callId: call.call_id, alert: 0, tenantMeta: TENANT });
    let jobs = ringJobs();
    expect(jobs.at(-1)[2]).toMatchObject({ callId: call.call_id, alert: 1 });
    expect(jobs.at(-1)[3]).toMatchObject({ jobId: `callring-${call.call_id}-1`, delay: service.RING_REALERT_MS });

    // The same alert delivered twice by the queue: the claim sends it once.
    const again = await service.ringPush(client, { callId: call.call_id, alert: 0, tenantMeta: TENANT });
    expect(again).toMatchObject({ pushed: false, reason: "already sent" });

    for (const alert of [1, 2, 3, 4]) {
      const out = await service.ringPush(client, { callId: call.call_id, alert, tenantMeta: TENANT });
      expect(out.pushed).toBe(true);
    }
    expect(push()).toHaveBeenCalledTimes(5);
    jobs = ringJobs();
    // No fifth re-alert is queued.
    expect(jobs.filter((j) => j[2].alert === 5)).toHaveLength(0);
    expect(store.calls.get(call.call_id).ring_alerts).toBe(5);
  });

  test("re-alerts stop when the call is answered, declined or ends, and outside the window", async () => {
    const store = makeStore();
    const answered = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    store.calls.get(answered.call_id).status = "IN_CALL";
    expect(await service.ringPush(makeClient({ store }), { callId: answered.call_id, alert: 2, tenantMeta: TENANT }))
      .toMatchObject({ pushed: false, reason: "no longer ringing" });
    store.calls.get(answered.call_id).status = "ENDED";

    const late = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    late.started_at = new Date(Date.now() - 61_000).toISOString();
    expect(await service.ringPush(makeClient({ store }), { callId: late.call_id, alert: 3, tenantMeta: TENANT }))
      .toMatchObject({ pushed: false, reason: "ring window over" });
    expect(push()).not.toHaveBeenCalled();
    expect(ringJobs()).toHaveLength(0);
  });

  test("no re-alert is queued past the end of the ring window", async () => {
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    call.started_at = new Date(Date.now() - 50_000).toISOString(); // 10 s left
    await service.ringPush(makeClient({ store }), { callId: call.call_id, alert: 0, tenantMeta: TENANT });
    expect(push()).toHaveBeenCalledTimes(1);
    expect(ringJobs()).toHaveLength(0);
  });

  describe("the cancel push (A7, E8)", () => {
    const cancelJobs = () => ringJobs().filter((j) => j[1] === "cancel");

    test.each([
      ["answered", async (store, call) => { await inTenant(() => service.acceptCall(makeClient({ store }), { id: call.call_id, actor: { user_id: U2 }, tenantMeta: TENANT })); }],
      ["declined", async (store, call) => { await inTenant(() => service.declineCall(makeClient({ store }), { id: call.call_id, actor: { user_id: U2 }, tenantMeta: TENANT })); }],
      ["missed", async (store, call) => { await inTenant(() => service.hangup(makeClient({ store }), { id: call.call_id, actor: { user_id: U1 }, tenantMeta: TENANT })); }],
    ])("is queued when the ring ends: %s", async (outcome, act) => {
      const store = makeStore();
      const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
      await act(store, call);
      expect(cancelJobs()).toHaveLength(1);
      expect(cancelJobs()[0][2]).toMatchObject({ callId: call.call_id, outcome });
      expect(cancelJobs()[0][3].jobId).toBe(`callcancel-${call.call_id}`);
    });

    test("the sweep's no-answer is a missed call", async () => {
      const store = makeStore();
      const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
      call.started_at = new Date(Date.now() - 70_000).toISOString();
      await service.sweep(makeClient({ store }), { tenantSlug: "acme", tenantMeta: TENANT });
      expect(cancelJobs()[0][2]).toMatchObject({ callId: call.call_id, outcome: "missed" });
    });

    test("an in-call hang-up has no ring to cancel", async () => {
      const store = makeStore();
      const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
      store.transition(call.call_id, "RINGING", { status: "IN_CALL", connected_at: new Date().toISOString() });
      await inTenant(() => service.hangup(makeClient({ store }), { id: call.call_id, actor: { user_id: U1 }, tenantMeta: TENANT }));
      expect(cancelJobs()).toHaveLength(0);
    });

    test("replaces the ring on every device, in place and non-sticky, only when a ring was pushed", async () => {
      const store = makeStore();
      const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
      store.calls.get(call.call_id).status = "IN_CALL";
      let out = await service.ringCancel(makeClient({ store }), { callId: call.call_id, outcome: "answered" });
      expect(out).toMatchObject({ pushed: false, reason: "no ring was pushed" });

      store.calls.get(call.call_id).ring_push_sent_at = new Date().toISOString();
      out = await service.ringCancel(makeClient({ store }), { callId: call.call_id, outcome: "answered" });
      expect(out.pushed).toBe(true);
      const payload = push().mock.calls[0][1];
      expect(payload).toMatchObject({
        user_id: U2,
        tag: `call:${call.call_id}`,
        requireInteraction: false,
        renotify: false,
        urgency: "high",
        url: `/comms?channel=${G1}`,
        title: "Answered on another device",
      });
      expect(payload.actions).toBeUndefined();
      expect(payload.data).toMatchObject({ kind: "call_cancel", call_id: call.call_id, group_id: G1, outcome: "answered" });
    });

    test("a missed call names the caller and outlives a phone that was off", async () => {
      const store = makeStore();
      const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
      Object.assign(store.calls.get(call.call_id), { status: "NO_ANSWER", ring_push_sent_at: new Date().toISOString() });
      await service.ringCancel(makeClient({ store }), { callId: call.call_id, outcome: "missed" });
      const payload = push().mock.calls[0][1];
      expect(payload.title).toMatch(/^Missed call/);
      expect(payload.ttl).toBeGreaterThanOrEqual(3600);
    });
  });

  test("the caller's other devices hear who is being called (call:ringing_sent)", async () => {
    const store = makeStore();
    await inTenant(() =>
      service.createCall(makeClient({ store, members: [MEMBER1] }), { groupId: G1, actor: { user_id: U1 }, tenantMeta: TENANT }),
    );
    const sent = publishSpy.mock.calls.find((c) => c[3] === "call:ringing_sent");
    expect(sent[2]).toBe(U1);
    expect(sent[4]).toMatchObject({ call_id: "call-1", group_id: G1, to: { user_id: U2 } });
  });
});

describe("the ringing read (A13)", () => {
  test("lists the calls ringing for me, within the window, with the seconds left", async () => {
    const client = {
      query: jest.fn(async (sql, params) => {
        if (/FROM comms_call c/.test(sql) && /c\.callee_id = \$1/.test(sql)) {
          expect(sql).toMatch(/c\.status = 'RINGING'/);
          expect(params).toEqual([U2, 60]);
          return {
            rows: [{
              call_id: "call-9", group_id: G1, caller_id: U1, callee_id: U2, status: "RINGING",
              started_at: new Date().toISOString(), caller_name: "Aïcha", ring_seconds_left: 42, turn_token: "secret",
            }],
          };
        }
        if (/feature_state/.test(sql)) return { rows: [{ state: "on", tenant_enabled: true }] };
        return { rows: [] };
      }),
    };
    const rows = await service.listRinging(client, { user_id: U2 });
    expect(rows).toEqual([expect.objectContaining({
      call_id: "call-9", caller_name: "Aïcha", ring_seconds_left: 42, recording_enabled: true, noise_suppression: false,
    })]);
    expect(rows[0]).not.toHaveProperty("turn_token");
  });
});

describe("a test ring (A15)", () => {
  test("goes to this device only, shaped like a ring", async () => {
    const out = await service.testRing({ query: async () => ({ rows: [] }) }, {
      actor: { user_id: U2 }, endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    });
    expect(out.sent).toBe(1);
    const payload = require("../../src/shared/push/push.service").sendToUser.mock.calls[0][1];
    expect(payload).toMatchObject({
      user_id: U2,
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      urgency: "high",
      vibrate: [600, 250, 600, 250, 600],
      tag: "call:test",
      data: { kind: "call_test" },
    });
  });
});

describe("the noise filter's default (E5)", () => {
  test("is off until a tenant turns it on", async () => {
    const settings = await service.callSettings({ query: async () => ({ rows: [] }) });
    expect(settings.noise_suppression).toBe(false);
  });
});

describe("call liveness — the row's fourth way to end (FN-1)", () => {
  const offKey = (uid) => `presence:off:acme:live:${uid}`;
  const onKey = (uid) => `presence:acme:live:${uid}`;
  const goneSince = async (uid, msAgo) => mockRedis.set(offKey(uid), String(Date.now() - msAgo));

  /** An answered call, five minutes in: past the ring deadline's concern,
   *  far from the 30-minute cap, so liveness is the only thing that can move
   *  it. */
  function inCall(store) {
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    store.transition(call.call_id, "RINGING", {
      status: "IN_CALL",
      connected_at: new Date(Date.now() - 300_000).toISOString(),
    });
    return call;
  }

  test("a call whose both devices have been gone 60 s ends itself, reason disconnected", async () => {
    const store = makeStore();
    const call = inCall(store);
    await goneSince(U1, 120_000);
    await goneSince(U2, 119_000);
    const { moved } = await service.sweep(makeClient({ store }), { tenantSlug: "acme", env: "live" });
    expect(moved).toBe(1);
    const row = store.calls.get(call.call_id);
    expect(row.status).toBe("ENDED");
    expect(row.end_reason).toBe("disconnected");
    expect(row.ended_at).toBeTruthy();
  });

  test("one device gone 2 minutes and the other only just gone keeps the call alive (B2: both, not either)", async () => {
    const store = makeStore();
    const call = inCall(store);
    await goneSince(U1, 120_000);
    await goneSince(U2, 5_000);
    const { moved } = await service.sweep(makeClient({ store }), { tenantSlug: "acme", env: "live" });
    expect(moved).toBe(0);
    expect(store.calls.get(call.call_id).status).toBe("IN_CALL");
  });

  test("one device still online keeps the call alive, no matter how old the other's absence", async () => {
    const store = makeStore();
    const call = inCall(store);
    await mockRedis.zadd(onKey(U1), Date.now() + 90_000, "socket-1");
    await goneSince(U2, 600_000);
    const { moved } = await service.sweep(makeClient({ store }), { tenantSlug: "acme", env: "live" });
    expect(moved).toBe(0);
    expect(store.calls.get(call.call_id).status).toBe("IN_CALL");
  });

  test("a crashed replica's socket stops counting once its 90 s lapse (B3)", async () => {
    const store = makeStore();
    const call = inCall(store);
    // U1's only socket was last refreshed 2 minutes ago by a replica that died:
    // its score is in the past, so it no longer makes U1 online.
    await mockRedis.zadd(onKey(U1), Date.now() - 30_000, "dead-replica-socket");
    await goneSince(U1, 120_000);
    await goneSince(U2, 120_000);
    const { moved } = await service.sweep(makeClient({ store }), { tenantSlug: "acme", env: "live" });
    expect(moved).toBe(1);
    expect(store.calls.get(call.call_id).end_reason).toBe("disconnected");
  });

  test("a fresh absence (under 60 s) does not end the call — the airplane row survives", async () => {
    const store = makeStore();
    const call = inCall(store);
    // Nobody online and no record yet: the first check records the absence…
    const first = await service.sweep(makeClient({ store }), { tenantSlug: "acme", env: "live" });
    expect(first.moved).toBe(0);
    expect(store.calls.get(call.call_id).status).toBe("IN_CALL");
    // …and a check moments later still sees it as fresh.
    const second = await service.sweep(makeClient({ store }), { tenantSlug: "acme", env: "live" });
    expect(second.moved).toBe(0);
    expect(store.calls.get(call.call_id).status).toBe("IN_CALL");
  });

  test("a RINGING row is the ring deadline's alone — liveness never touches it", async () => {
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    call.started_at = new Date(Date.now() - 10_000).toISOString(); // 50 s from NO_ANSWER
    await goneSince(U1, 300_000);
    await goneSince(U2, 300_000);
    const { moved } = await service.sweep(makeClient({ store }), { tenantSlug: "acme", env: "live" });
    expect(moved).toBe(0);
    expect(store.calls.get(call.call_id).status).toBe("RINGING");
  });

  test("a presence outage skips liveness and never breaks the ordinary deadlines", async () => {
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    call.started_at = new Date(Date.now() - 70_000).toISOString(); // due: NO_ANSWER
    const other = store.insert({ groupId: G1, callerId: U3, calleeId: "55555555-5555-5555-5555-555555555555" });
    store.transition(other.call_id, "RINGING", { status: "IN_CALL", connected_at: new Date(Date.now() - 300_000).toISOString() });
    mockRedis._state.fail = true;
    const { moved } = await service.sweep(makeClient({ store }), { tenantSlug: "acme", env: "live" });
    mockRedis._state.fail = false;
    expect(moved).toBe(1);
    expect(store.calls.get(call.call_id).status).toBe("NO_ANSWER");
    expect(store.calls.get(other.call_id).status).toBe("IN_CALL");
  });

  test("the liveness job ends a call both sides left over 60 s ago", async () => {
    const store = makeStore();
    const call = inCall(store);
    await goneSince(U1, 70_000);
    await goneSince(U2, 65_000);
    const out = await service.checkLiveness(makeClient({ store }), { callId: call.call_id, tenantMeta: TENANT, env: "live" });
    expect(out.moved).toBe(true);
    expect(store.calls.get(call.call_id).end_reason).toBe("disconnected");
  });

  test("the liveness job checks again when both will have been gone 60 s", async () => {
    const store = makeStore();
    const call = inCall(store);
    await goneSince(U1, 60_000);
    await goneSince(U2, 20_000);
    const enqueue = require("../../src/jobs/queue-producer").enqueue;
    const out = await service.checkLiveness(makeClient({ store }), { callId: call.call_id, tenantMeta: TENANT, env: "live" });
    expect(out).toEqual({ moved: false, reason: "rechecking" });
    const again = enqueue.mock.calls.find((c) => c[0] === "comms-call-clock" && c[1] === "liveness");
    expect(again).toBeTruthy();
    // Due ~40 s from now (U2's 60 s window), not another full minute.
    expect(again[3].delay).toBeGreaterThan(38_000);
    expect(again[3].delay).toBeLessThan(42_000);
  });

  test("the liveness job leaves a call alone while either side is online", async () => {
    const store = makeStore();
    const call = inCall(store);
    await mockRedis.zadd(onKey(U2), Date.now() + 90_000, "s");
    await goneSince(U1, 600_000);
    const out = await service.checkLiveness(makeClient({ store }), { callId: call.call_id, tenantMeta: TENANT, env: "live" });
    expect(out.moved).toBe(false);
    expect(store.calls.get(call.call_id).status).toBe("IN_CALL");
  });
});

describe("per-call clocks (D1)", () => {
  const clockJobs = () => require("../../src/jobs/queue-producer").enqueue.mock.calls
    .filter((c) => c[0] === "comms-call-clock");

  test("a dial queues its own ring deadline at +60 s and puts the tenant in the active set", async () => {
    const store = makeStore();
    const out = await inTenant(() => service.createCall(makeClient({ store, members: [MEMBER1] }), {
      groupId: G1, actor: { user_id: U1 }, tenantMeta: TENANT, env: "live",
    }));
    const [job] = clockJobs();
    expect(job[1]).toBe("ring");
    expect(job[2]).toMatchObject({ callId: out.call_id, env: "live" });
    expect(job[3].jobId).toBe(`callclock-ring-${out.call_id}`);
    expect(job[3].delay).toBeGreaterThan(59_000);
    expect(job[3].delay).toBeLessThanOrEqual(60_500);
    expect(await mockRedis.zscore("praxis:comms:call-tenants", "acme|live")).not.toBeNull();
  });

  test("an answer queues the 30-minute cap and records the live call for both sides", async () => {
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    await inTenant(() => service.acceptCall(makeClient({ store }), {
      id: call.call_id, actor: { user_id: U2 }, tenantMeta: TENANT, env: "live",
    }));
    const cap = clockJobs().find((c) => c[1] === "cap");
    expect(cap[3].jobId).toBe(`callclock-cap-${call.call_id}`);
    expect(cap[3].delay).toBeGreaterThan(1_799_000);
    expect(await mockRedis.get(`presence:call:acme:live:${U1}`)).toBe(call.call_id);
    expect(await mockRedis.get(`presence:call:acme:live:${U2}`)).toBe(call.call_id);
  });

  test("hanging up forgets the live call", async () => {
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    await inTenant(() => service.acceptCall(makeClient({ store }), {
      id: call.call_id, actor: { user_id: U2 }, tenantMeta: TENANT, env: "live",
    }));
    await inTenant(() => service.hangup(makeClient({ store }), { id: call.call_id, actor: { user_id: U1 }, tenantMeta: TENANT }));
    expect(await mockRedis.get(`presence:call:acme:live:${U1}`)).toBeNull();
    expect(await mockRedis.get(`presence:call:acme:live:${U2}`)).toBeNull();
  });

  test("the ring job ends a ring that is due, and only that", async () => {
    const store = makeStore();
    const due = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    due.started_at = new Date(Date.now() - 61_000).toISOString();
    const out = await service.expireRing(makeClient({ store }), { callId: due.call_id, tenantMeta: TENANT, env: "live" });
    expect(out.moved).toBe(true);
    expect(store.calls.get(due.call_id).status).toBe("NO_ANSWER");
    // The worker has no ambient tenant: the job's slug reaches the publish.
    expect(publishSpy.mock.calls.find((c) => c[3] === "call:no_answer")[0]).toBe("acme");
  });

  test("a ring job that runs early re-queues itself instead of ending the ring", async () => {
    const store = makeStore();
    const early = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    const out = await service.expireRing(makeClient({ store }), { callId: early.call_id, tenantMeta: TENANT, env: "live" });
    expect(out).toEqual({ moved: false, reason: "not due" });
    expect(store.calls.get(early.call_id).status).toBe("RINGING");
    expect(clockJobs().find((c) => c[1] === "ring")).toBeTruthy();
  });

  test("a ring job for an answered call does nothing", async () => {
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    call.started_at = new Date(Date.now() - 61_000).toISOString();
    store.transition(call.call_id, "RINGING", { status: "IN_CALL", connected_at: new Date().toISOString() });
    const out = await service.expireRing(makeClient({ store }), { callId: call.call_id, tenantMeta: TENANT, env: "live" });
    expect(out.moved).toBe(false);
    expect(store.calls.get(call.call_id).status).toBe("IN_CALL");
  });

  test("the cap job ends a call at 30 minutes with 1800 s recorded", async () => {
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    store.transition(call.call_id, "RINGING", {
      status: "IN_CALL", connected_at: new Date(Date.now() - 1_801_000).toISOString(),
    });
    const out = await service.capCall(makeClient({ store }), { callId: call.call_id, tenantMeta: TENANT, env: "live" });
    expect(out.moved).toBe(true);
    expect(store.calls.get(call.call_id)).toMatchObject({ status: "ENDED", end_reason: "max_duration", duration_seconds: 1800 });
  });

  test("the safety sweep reports how many calls are still live", async () => {
    const store = makeStore();
    store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    expect(await service.sweep(makeClient({ store }), { tenantSlug: "acme" })).toEqual({ moved: 0, live: 1 });
    expect(await service.sweep(makeClient({ store: makeStore() }), { tenantSlug: "acme" })).toEqual({ moved: 0, live: 0 });
  });
});

describe("ring pushes are fair across tenants (leftover from PR-4)", () => {
  const ringJobs = () => require("../../src/jobs/queue-producer").enqueue.mock.calls
    .filter((c) => c[0] === "comms-call-ring-escalate");

  test("a first ring and a cancel go ahead of every re-alert", async () => {
    const first = await service.ringPriority({ slug: "acme", urgent: true });
    for (let i = 0; i < 500; i += 1) await service.ringPriority({ slug: "busy", urgent: true });
    const burstTail = await service.ringPriority({ slug: "busy", urgent: true });
    const realert = await service.ringPriority({ slug: "quiet", urgent: false });
    expect(first).toBe(1);
    expect(realert).toBeGreaterThan(burstTail);
  });

  test("a burst of 200 rings at one tenant does not queue another tenant's ring behind it", async () => {
    for (let i = 0; i < 200; i += 1) {
      await service.enqueueRingPush({ callId: `busy-${i}`, tenantMeta: { slug: "busy" }, env: "live", alert: 0 });
    }
    await service.enqueueRingPush({ callId: "other", tenantMeta: { slug: "other" }, env: "live", alert: 0 });
    const jobs = ringJobs();
    const other = jobs.find((c) => c[2].callId === "other")[3].priority;
    const busy = jobs.filter((c) => String(c[2].callId).startsWith("busy-")).map((c) => c[3].priority);
    // BullMQ serves the lowest priority first: the other tenant's first ring
    // ties the busy tenant's first and is ahead of its other 199.
    expect(other).toBe(Math.min(...busy));
    expect(busy.filter((p) => p > other)).toHaveLength(199);
  });

  test("cancels are urgent, re-alerts are not", async () => {
    await service.enqueueRingCancel({ callId: "c1", outcome: "missed", tenantMeta: { slug: "acme" }, env: "live" });
    await service.enqueueRingPush({ callId: "c1", tenantMeta: { slug: "acme" }, env: "live", alert: 2 });
    const [cancel, realert] = ringJobs();
    expect(cancel[3].priority).toBeLessThan(100_000);
    expect(realert[3].priority).toBeGreaterThan(100_000);
  });

  test("with Redis down the ring still queues, unranked in its class", async () => {
    mockRedis._state.fail = true;
    expect(await service.ringPriority({ slug: "acme", urgent: true })).toBe(1);
    mockRedis._state.fail = false;
  });
});

describe("ring concurrency comes from configuration", () => {
  test("COMMS_CALL_RING_CONCURRENCY sizes the ring worker", () => {
    const { config } = require("../../src/config/env");
    expect(config.COMMS_CALL_RING_CONCURRENCY).toBe(16);
    const src = require("fs").readFileSync(require.resolve("../../src/jobs/workers.js"), "utf8");
    expect(src).toMatch(/name: "comms-call-ring-escalate", concurrency: config\.COMMS_CALL_RING_CONCURRENCY/);
  });
});

describe("day counters at each transition (audit D4)", () => {
  const day = () => new Date().toISOString().slice(0, 10);
  const counter = (field, env = "live") => mockRedis.get(`praxis:callm:${day()}:acme:${env}:${field}`);

  test("dial, answer and hang-up count what the metrics screen shows", async () => {
    const store = makeStore();
    const out = await inTenant(() => service.createCall(makeClient({ store, members: [MEMBER1] }), {
      groupId: G1, actor: { user_id: U1 }, tenantMeta: TENANT, env: "live",
    }));
    await inTenant(() => service.acceptCall(makeClient({ store }), { id: out.call_id, actor: { user_id: U2 }, tenantMeta: TENANT }));
    store.calls.get(out.call_id).connected_at = new Date(Date.now() - 90_000).toISOString();
    await inTenant(() => service.hangup(makeClient({ store }), { id: out.call_id, actor: { user_id: U1 }, tenantMeta: TENANT }));
    expect(await counter("calls_started")).toBe("1");
    expect(await counter("calls_answered")).toBe("1");
    expect(await counter("answered_ended")).toBe("1");
    expect(Number(await counter("duration_sum"))).toBeGreaterThanOrEqual(89);
  });

  test("an unanswered ring counts as no answer, in its own env", async () => {
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    call.started_at = new Date(Date.now() - 61_000).toISOString();
    await service.sweep(makeClient({ store }), { tenantSlug: "acme", env: "sandbox" });
    expect(await counter("calls_no_answer", "sandbox")).toBe("1");
    expect(await counter("calls_no_answer", "live")).toBeNull();
  });
});

/* ── PR-6: privacy defaults, consent and do not disturb ───────────────────── */

describe("recording is the tenant's own opt-in (audit G1)", () => {
  const flagClient = (state, tenantEnabled) => ({
    query: async (sql) => (/FROM feature_state/.test(sql)
      ? { rows: state ? [{ state, tenant_enabled: tenantEnabled }] : [] }
      : { rows: [] }),
  });

  test("the platform feature alone does not record: the tenant must have switched it on", async () => {
    expect(await service.recordingEnabled(flagClient("on", false))).toBe(false);
    expect(await service.recordingEnabled(flagClient("on", null))).toBe(false);
    expect(await service.recordingEnabled(flagClient("on", true))).toBe(true);
    expect(await service.recordingEnabled(flagClient("off", true))).toBe(false);
  });

  test("the read names the tenant setting", async () => {
    let sql = "";
    await service.recordingEnabled({ query: async (s) => { sql = s; return { rows: [] }; } });
    expect(sql).toMatch(/section = 'comms' AND s\.key = 'call_recording'/);
    expect(sql).toMatch(/value -> 'enabled'/);
  });
});

describe("answer without recording (audit G5)", () => {
  const recordingOn = (store) => {
    const base = makeClient({ store });
    return {
      query: async (sql, params) => (/FROM feature_state/.test(sql)
        ? { rows: [{ state: "on", tenant_enabled: true }] }
        : base.query(sql, params)),
    };
  };

  test("the choice is stored on the call, the answer says not recording, and so does the caller's event", async () => {
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    const out = await inTenant(() => service.acceptCall(recordingOn(store), {
      id: call.call_id, actor: { user_id: U2 }, tenantMeta: TENANT, record: false,
    }));
    expect(out.recording_enabled).toBe(false);
    const row = store.calls.get(call.call_id);
    expect(row.recording_declined_at).toBeTruthy();
    expect(row.recording_declined_by).toBe(U2);
    const toCaller = publishSpy.mock.calls.find((c) => c[2] === U1 && c[3] === "call:accepted");
    expect(toCaller[4]).toMatchObject({ recording_enabled: false });
  });

  test("answering normally records as the tenant has it", async () => {
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    const out = await inTenant(() => service.acceptCall(recordingOn(store), {
      id: call.call_id, actor: { user_id: U2 }, tenantMeta: TENANT,
    }));
    expect(out.recording_enabled).toBe(true);
    expect(store.calls.get(call.call_id).recording_declined_at).toBeUndefined();
  });

  test("a declined call reads as not recorded for either side", async () => {
    expect(await service.recordingForCall({ query: async () => ({ rows: [{ state: "on", tenant_enabled: true }] }) },
      { recording_declined_at: new Date().toISOString() })).toBe(false);
  });
});

describe("do not disturb (audit C6)", () => {
  test("a callee with calls on do not disturb is not rung", async () => {
    const store = makeStore();
    const base = makeClient({ store, members: [MEMBER1] });
    const client = {
      query: async (sql, params) => (/FROM live\.user_preference/.test(sql)
        ? { rows: [{ user_id: U2, key: "do_not_disturb", value: true }] }
        : base.query(sql, params)),
    };
    await expect(inTenant(() => service.createCall(client, { groupId: G1, actor: { user_id: U1 }, tenantMeta: TENANT })))
      .rejects.toMatchObject({ code: "CALLEE_DND", status: 409 });
    expect(store.calls.size).toBe(0);
    expect(publishSpy.mock.calls.filter((c) => c[3] === "call:ringing")).toHaveLength(0);
  });

  test("an unreadable preference does not stop the call", async () => {
    const store = makeStore();
    const base = makeClient({ store, members: [MEMBER1] });
    const client = {
      query: async (sql, params) => {
        if (/FROM live\.user_preference/.test(sql)) throw new Error("boom");
        return base.query(sql, params);
      },
    };
    await inTenant(() => service.createCall(client, { groupId: G1, actor: { user_id: U1 }, tenantMeta: TENANT }));
    expect(store.calls.size).toBe(1);
  });
});

describe("how calls are processed (audit G2)", () => {
  test("names only the vendors that are configured, in the pipeline's order", async () => {
    const vendors = require("../../src/services/platform/ai-vendor.service");
    const spy = jest.spyOn(vendors, "getConfig").mockImplementation(async (v) =>
      (v === "deepseek" ? null : { vendor: v, api_key: "k", is_active: true }));
    // The test environment sets no vendor keys, so the platform credentials decide.
    const out = await service.processingDisclosure({ query: async () => ({ rows: [{ state: "on", tenant_enabled: true }] }) });
    spy.mockRestore();
    expect(out.recording_enabled).toBe(true);
    expect(out.transcription.map((p) => [p.vendor, p.role])).toEqual([["groq", "first"], ["gemini", "when_first_fails"]]);
    expect(out.summary.map((p) => [p.vendor, p.role])).toEqual([["gemini", "first"]]);
    expect(out.transcription[1].name).toBe("Google (Gemini)");
  });
});
