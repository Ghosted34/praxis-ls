"use strict";

/**
 * Field note FN-2: a socket is not the call.
 *
 * The liveness sweep reads SOCKET presence and ends an IN_CALL call whose two
 * participants have both been unreachable for LIVENESS_OFFLINE_S. That is a
 * proxy, and it was a bad one: call audio is peer-to-peer, so this process
 * never sees it, and a WebSocket can die over a perfectly healthy media path —
 * a 4G handover in the corridor, a phone that backgrounded the tab, a socket
 * replica that went away. At the old 60 s window a call with two people
 * talking on it was ended `disconnected`.
 *
 * Two changes, both asserted here:
 *   1. the window is 180 s, past every handover we have measured;
 *   2. before ending anything, the verdict asks the browsers. A media beat
 *      (HTTP, so it survives the dead socket) for THIS call outranks the
 *      sockets.
 *
 * No database: `livenessVerdict` is reached through the exported
 * `checkLiveness`, with the repo read faked. Redis is the in-memory stand-in.
 */

jest.mock("../../src/config/redis", () => {
  const fake = require("../helpers/fake-redis").createFakeRedis();
  return { getClient: () => fake, __fake: fake };
});
jest.mock("../../src/jobs/queue-producer", () => ({ enqueue: jest.fn(async () => null) }));
jest.mock("../../src/realtime", () => ({ publishToUser: jest.fn(), publish: jest.fn() }));
// The event and audit writes are another suite's subject; here they would only
// pull a real database in behind the one decision under test.
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => null),
  audit: jest.fn(async () => null),
  resolveActorId: jest.fn(() => null),
}));

const redis = require("../../src/config/redis").__fake;
const repo = require("../../src/modules/smartcomm/smartcomm.call.repo");
const service = require("../../src/modules/smartcomm/smartcomm.call.service");

const SLUG = "fn2tenant";
const CALL = "11111111-1111-1111-1111-111111111111";
const CALLER = "aaaaaaaa-0000-0000-0000-000000000001";
const CALLEE = "bbbbbbbb-0000-0000-0000-000000000002";

const tenantMeta = { slug: SLUG };
/** Enough of a pg client for the paths that survive the mocks above. */
const db = { query: async () => ({ rows: [] }) };
const liveCall = {
  call_id: CALL,
  caller_id: CALLER,
  callee_id: CALLEE,
  status: "IN_CALL",
  connected_at: new Date(Date.now() - 60_000).toISOString(),
};

/** Both sockets gone this many ms ago, with no media beat from either side. */
async function bothSocketsGone(ms) {
  const at = String(Date.now() - ms);
  await redis.set(`presence:off:${SLUG}:live:${CALLER}`, at);
  await redis.set(`presence:off:${SLUG}:live:${CALLEE}`, at);
}

describe("call liveness does not trust sockets alone (FN-2)", () => {
  let endSpy;

  beforeEach(async () => {
    redis._reset();
    jest.spyOn(repo, "findCall").mockResolvedValue(liveCall);
    // The transition is the thing under test: did the verdict decide to end it?
    endSpy = jest.spyOn(repo, "transition").mockResolvedValue({ ...liveCall, status: "ENDED" });
  });
  afterEach(() => jest.restoreAllMocks());

  it("gives a dropped socket three minutes, not one", async () => {
    // 90 s: over the old 60 s window, under the new one. This is the case
    // that used to end a healthy call.
    await bothSocketsGone(90_000);
    const out = await service.checkLiveness(db, { callId: CALL, tenantMeta, env: "live" });
    expect(out.moved).toBe(false);
    expect(endSpy).not.toHaveBeenCalled();
  });

  it("ends a genuinely abandoned call once the window has passed", async () => {
    await bothSocketsGone(400_000);
    const out = await service.checkLiveness(db, { callId: CALL, tenantMeta, env: "live" });
    expect(out.moved).toBe(true);
    expect(endSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "ENDED", fields: expect.objectContaining({ end_reason: "disconnected" }) }),
    );
  });

  it("keeps the call when either browser beats that its media is up", async () => {
    await bothSocketsGone(400_000);
    await redis.set(`presence:media:${SLUG}:live:${CALLEE}`, CALL);
    const out = await service.checkLiveness(db, { callId: CALL, tenantMeta, env: "live" });
    expect(out.moved).toBe(false);
    expect(endSpy).not.toHaveBeenCalled();
  });

  it("ignores a beat left over from a different call", async () => {
    await bothSocketsGone(400_000);
    await redis.set(`presence:media:${SLUG}:live:${CALLER}`, "99999999-9999-9999-9999-999999999999");
    const out = await service.checkLiveness(db, { callId: CALL, tenantMeta, env: "live" });
    expect(out.moved).toBe(true);
  });

  it("re-checks rather than ending, so a beat that stops still ends the call", async () => {
    await bothSocketsGone(400_000);
    await redis.set(`presence:media:${SLUG}:live:${CALLER}`, CALL);
    const { enqueue } = require("../../src/jobs/queue-producer");
    enqueue.mockClear();
    await service.checkLiveness(db, { callId: CALL, tenantMeta, env: "live" });
    // A liveness job is queued again: the beat buys time, never immunity.
    expect(enqueue).toHaveBeenCalledWith(
      "comms-call-clock", "liveness", expect.objectContaining({ callId: CALL }), expect.anything(),
    );
  });

  it("never ends a call it cannot read presence for", async () => {
    redis._state.fail = true;
    try {
      const out = await service.checkLiveness(db, { callId: CALL, tenantMeta, env: "live" });
      expect(out.moved).toBe(false);
      expect(endSpy).not.toHaveBeenCalled();
    } finally {
      redis._state.fail = false;
    }
  });
});

describe("the media beat itself", () => {
  afterEach(() => jest.restoreAllMocks());

  it("is refused for somebody who is not in the call", async () => {
    jest.spyOn(repo, "findCall").mockResolvedValue(liveCall);
    await expect(service.recordMediaBeat(db, {
      id: CALL, actor: { user_id: "cccccccc-0000-0000-0000-000000000003" }, tenantMeta, env: "live",
    })).rejects.toMatchObject({ status: 404 });
  });

  it("records nothing for a call that is no longer in progress", async () => {
    jest.spyOn(repo, "findCall").mockResolvedValue({ ...liveCall, status: "ENDED" });
    const out = await service.recordMediaBeat(db, {
      id: CALL, actor: { user_id: CALLER }, tenantMeta, env: "live",
    });
    expect(out.recorded).toBe(false);
    expect(await redis.get(`presence:media:${SLUG}:live:${CALLER}`)).toBeFalsy();
  });

  it("records a participant's beat against the call they are in", async () => {
    jest.spyOn(repo, "findCall").mockResolvedValue(liveCall);
    const out = await service.recordMediaBeat(db, {
      id: CALL, actor: { user_id: CALLER }, tenantMeta, env: "live",
    });
    expect(out.recorded).toBe(true);
    expect(await redis.get(`presence:media:${SLUG}:live:${CALLER}`)).toBe(CALL);
  });
});
