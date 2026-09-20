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
// PR-3: createCall queues the delayed ring escalation, and escalateRing pushes.
// Both are mocked: this suite is about the service's decisions (who may ack,
// which claim wins), not about BullMQ or a live push service.
jest.mock("../../src/jobs/queue-producer", () => ({ enqueue: jest.fn(async () => ({})) }));
jest.mock("../../src/shared/push/push.service", () => ({
  sendToUser: jest.fn(async () => ({ sent: 1, failed: 0, total: 1 })),
}));
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
      if (/UPDATE comms_call\s+SET ring_push_sent_at = now\(\)/.test(sql)) {
        const row = store.calls.get(params[0]);
        if (!row || row.ring_push_sent_at) return { rows: [] };
        row.ring_push_sent_at = new Date().toISOString();
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
let publishSpy;

beforeEach(() => {
  thisSkipActiveLookup = 0;
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
    const toCallee = publishSpy.mock.calls.find((c) => c[1] === U2 && c[2] === "call:ringing");
    expect(toCallee).toBeTruthy();
    expect(toCallee[0]).toBe("acme");
    expect(toCallee[3].call_id).toBe(result.call_id);
    const toCaller = publishSpy.mock.calls.find((c) => c[1] === U1 && c[2] === "call:ringing_sent");
    expect(toCaller).toBeTruthy();
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
    expect(publishSpy.mock.calls.filter((c) => c[2] === "call:accepted")).toHaveLength(2);
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
    expect(publishSpy.mock.calls.some((c) => c[2] === "call:cancelled")).toBe(true);
  });

  test("the callee hanging up mid-ring is a DECLINED", async () => {
    const { store, call } = await ringing();
    const updated = await inTenant(() =>
      service.hangup(makeClient({ store }), { id: call.call_id, actor: { user_id: U2 } }),
    );
    expect(updated.status).toBe("DECLINED");
    expect(updated.end_reason).toBe("declined");
    expect(publishSpy.mock.calls.some((c) => c[2] === "call:declined")).toBe(true);
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
    expect(publishSpy.mock.calls.filter((c) => c[2] === "call:ended")).toHaveLength(2);
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

describe("the sweep — the only clock", () => {
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
    const ended = publishSpy.mock.calls.find((c) => c[2] === "call:ended" && c[1] === U1);
    expect(ended).toBeTruthy();
    expect(ended[0]).toBe("acme");
    expect(ended[3].reason).toBe("max_duration");
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

  test("a participant gets a TURN credential scoped to themselves", async () => {
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    const ice = await inTenant(() =>
      service.turnFor(makeClient({ store }), { id: call.call_id, actor: { user_id: U2 } }),
    );
    expect(Array.isArray(ice.iceServers)).toBe(true);
    if (ice.turnConfigured) {
      const turn = ice.iceServers.find((s) => String(s.urls[0]).startsWith("turn:"));
      expect(turn).toBeTruthy();
      expect(String(turn.username)).toContain(U2);
    }
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
 * PR-3 §4.6 — the ring escalation. The two claims in the table are the whole
 * protocol: `ring_ack_at` is the durable stop (a delayed job re-reads it five
 * seconds later), and `ring_push_sent_at` is the single-send claim, so a queue
 * retry after a worker died mid-send cannot push twice.
 */
describe("ring ack and push escalation (PR-3)", () => {
  const findEscalations = () => {
    const { enqueue } = require("../../src/jobs/queue-producer");
    return enqueue.mock.calls.filter((c) => c[0] === "comms-call-ring-escalate");
  };

  test("a dial queues exactly one delayed escalation, keyed on the call", async () => {
    const store = makeStore();
    await inTenant(() =>
      service.createCall(makeClient({ store, members: [MEMBER1] }), {
        groupId: G1,
        actor: { user_id: U1, full_name: "A" },
      }),
    );
    const calls = findEscalations();
    expect(calls).toHaveLength(1);
    expect(calls[0][3].delay).toBe(service.RING_PUSH_DELAY_MS);
    expect(String(calls[0][3].jobId)).toContain("call-1");
  });

  test("the callee's first ack wins; a second device's ack is a quiet no-op", async () => {
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    const first = await service.ackRing(makeClient({ store }), {
      id: call.call_id,
      actor: { user_id: U2 },
      channel: "notification",
      tenantSlug: "acme",
    });
    expect(first.ring_ack_channel).toBe("notification");
    const second = await service.ackRing(makeClient({ store }), {
      id: call.call_id,
      actor: { user_id: U2 },
      channel: "push",
      tenantSlug: "acme",
    });
    expect(second).toBeNull();
    expect(store.calls.get(call.call_id).ring_ack_channel).toBe("notification");
    // The first ack is broadcast to the user's own room — never to the caller.
    const broadcast = publishSpy.mock.calls.find((c) => c[2] === "call:ring_ack");
    expect(broadcast[1]).toBe(U2);
  });

  test("the caller cannot ack their own ring, and an unknown channel is not stored", async () => {
    const store = makeStore();
    const call = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    expect(
      await service.ackRing(makeClient({ store }), { id: call.call_id, actor: { user_id: U1 } }),
    ).toBeNull();
    await service.ackRing(makeClient({ store }), {
      id: call.call_id,
      actor: { user_id: U2 },
      channel: "carrier-pigeon",
      tenantSlug: "acme",
    });
    // The vocabulary of the metric is closed: an unknown channel degrades to
    // the one we can honestly claim, rather than inventing a bucket.
    expect(store.calls.get(call.call_id).ring_ack_channel).toBe("socket");
  });

  test("escalation pushes once: it stands down on an ack, on a moved call, and on a retry", async () => {
    const push = require("../../src/shared/push/push.service");
    const store = makeStore();

    const acked = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    store.calls.get(acked.call_id).ring_ack_at = new Date().toISOString();
    let out = await service.escalateRing(makeClient({ store }), { callId: acked.call_id, tenantSlug: "acme" });
    expect(out).toMatchObject({ pushed: false, reason: "already acknowledged" });

    const ackedRow = store.calls.get(acked.call_id);
    ackedRow.status = "NO_ANSWER"; // out of the active set, as the sweep would leave it


    // The store enforces one ACTIVE call per party, so each row is moved OUT of
    // the active set before the next one is created — which is also what the
    // real table does.
    const moved = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    store.calls.get(moved.call_id).status = "IN_CALL";
    out = await service.escalateRing(makeClient({ store }), { callId: moved.call_id, tenantSlug: "acme" });
    expect(out).toMatchObject({ pushed: false, reason: "no longer ringing" });

    // The store's one-active-call guard is a property of the ACTIVE set, so a
    // finished call has to leave it before the next one can be created.
    store.calls.get(moved.call_id).status = "ENDED";


    const ringing = store.insert({ groupId: G1, callerId: U1, calleeId: U2 });
    out = await service.escalateRing(makeClient({ store }), { callId: ringing.call_id, tenantSlug: "acme" });
    expect(out.pushed).toBe(true);
    expect(push.sendToUser).toHaveBeenCalledTimes(1);
    const payload = push.sendToUser.mock.calls[0][1];
    expect(payload.user_id).toBe(U2);
    expect(payload.tag).toBe(`call:${ringing.call_id}`);
    expect(payload.actions.map((a) => a.action)).toEqual(["accept", "decline"]);
    expect(payload.data).toMatchObject({ kind: "call", call_id: ringing.call_id, caller_id: U1 });

    // A queue retry of the SAME job: the claim above stops the second send.
    out = await service.escalateRing(makeClient({ store }), { callId: ringing.call_id, tenantSlug: "acme" });
    expect(out).toMatchObject({ pushed: false, reason: "already escalated" });
    expect(push.sendToUser).toHaveBeenCalledTimes(1);
  });
});
