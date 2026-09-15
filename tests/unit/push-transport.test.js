"use strict";
/**
 * The web-push transport: what actually goes on the wire, and what happens when
 * a push service says no.
 *
 * The payload shape asserted here is a CONTRACT with
 * `client/public/push-handler.js`, which reads exactly these keys in the
 * service worker. A key added on one side and not the other is not an error
 * anywhere — it is a notification that quietly loses its deep link, its badge
 * or its icon — so the shape is pinned on this side too.
 */

const mockSendNotification = jest.fn(async () => ({ statusCode: 201 }));
const mockSetVapidDetails = jest.fn();

jest.mock("web-push", () => ({
  sendNotification: (...a) => mockSendNotification(...a),
  setVapidDetails: (...a) => mockSetVapidDetails(...a),
}), { virtual: true });

jest.mock("../../src/services/platform/settings.service", () => ({
  resolve: jest.fn(async () => null),
}));
jest.mock("../../src/config/env", () => ({
  config: {
    VAPID_PUBLIC_KEY: "PUB", VAPID_PRIVATE_KEY: "PRIV",
    VAPID_SUBJECT: "mailto:ops@praxisls.com",
  },
}));
jest.mock("../../src/services/platform/db", () => ({ query: null }));

const push = require("../../src/shared/push/push.service");

const SUB = { endpoint: "https://fcm.example/abc", p256dh: "k1", auth: "k2" };

function makeClient(subs = [SUB]) {
  return {
    query: jest.fn(async (sql) => {
      if (/SELECT endpoint/.test(sql)) return { rows: subs };
      return { rows: [], rowCount: 1 };
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSendNotification.mockResolvedValue({ statusCode: 201 });
});

describe("the payload the service worker receives", () => {
  test("carries everything the handler reads", async () => {
    const client = makeClient();
    await push.sendToUser(client, {
      user_id: "u-1", title: "Ama Boateng", body: "Re: BL 4471 — please confirm",
      url: "/comms/mail?thread=t-1", tag: "mail:t-1", renotify: true,
      requireInteraction: true, badgeCount: 7,
      data: { kind: "mail", thread_id: "t-1" },
      actions: [{ action: "open", title: "Open" }],
    });

    const [, payload] = mockSendNotification.mock.calls[0];
    const p = JSON.parse(payload);
    expect(p).toMatchObject({
      title: "Ama Boateng",
      body: "Re: BL 4471 — please confirm",
      url: "/comms/mail?thread=t-1",
      tag: "mail:t-1",
      renotify: true,
      requireInteraction: true,
      badgeCount: 7,
      data: { kind: "mail", thread_id: "t-1" },
      actions: [{ action: "open", title: "Open" }],
    });
    expect(typeof p.timestamp).toBe("number");
  });

  test("at most two actions — more than that is not rendered by a shade anyway", () => {
    const p = JSON.parse(push.buildPayload({
      title: "T",
      actions: [{ action: "a" }, { action: "b" }, { action: "c" }],
    }));
    expect(p.actions).toHaveLength(2);
  });

  test("defaults are safe: no tag (so notifications stack), the inbox as the link", () => {
    const p = JSON.parse(push.buildPayload({ title: "T" }));
    expect(p.tag).toBeUndefined();
    expect(p.url).toBe("/notifications");
    expect(p.renotify).toBe(false);
    expect(p.badgeCount).toBeNull();
  });
});

describe("the wire options", () => {
  test("urgency and a 24h TTL, so a phone that was off still hears about it", async () => {
    await push.sendToUser(makeClient(), { user_id: "u-1", title: "T", urgency: "high" });
    const [, , options] = mockSendNotification.mock.calls[0];
    expect(options).toEqual({ TTL: 86_400, urgency: "high" });
  });

  test("an unrecognised urgency falls back to normal rather than going on the wire", async () => {
    await push.sendToUser(makeClient(), { user_id: "u-1", title: "T", urgency: "URGENT!!" });
    expect(mockSendNotification.mock.calls[0][2].urgency).toBe("normal");
  });
});

describe("what happens when a send fails", () => {
  test("410 Gone prunes the dead subscription and is NOT counted as a failure", async () => {
    const client = makeClient();
    mockSendNotification.mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }));
    const out = await push.sendToUser(client, { user_id: "u-1", title: "T" });

    expect(out).toMatchObject({ sent: 0, failed: 0, pruned: 1, total: 1 });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM push_subscription/),
      [SUB.endpoint],
    );
  });

  test("a 500 IS a failure — that is the case the queue retries", async () => {
    mockSendNotification.mockRejectedValueOnce(Object.assign(new Error("boom"), { statusCode: 500 }));
    const out = await push.sendToUser(makeClient(), { user_id: "u-1", title: "T" });
    expect(out).toMatchObject({ sent: 0, failed: 1, pruned: 0 });
  });

  test("one bad device does not stop the others", async () => {
    const subs = [SUB, { ...SUB, endpoint: "https://fcm.example/def" }];
    mockSendNotification
      .mockRejectedValueOnce(Object.assign(new Error("boom"), { statusCode: 500 }))
      .mockResolvedValueOnce({ statusCode: 201 });
    const out = await push.sendToUser(makeClient(subs), { user_id: "u-1", title: "T" });
    expect(out).toMatchObject({ sent: 1, failed: 1, total: 2 });
  });
});

/*
 * ── THE OUTAGE THIS SECTION EXISTS FOR ──────────────────────────────────────
 *
 * A PushSubscription is bound to ONE application server key. Rotate the
 * deploy's VAPID pair and every subscription in every tenant is undeliverable
 * from that instant — and the push services say so with 403 (our signature is
 * not welcome), never 404/410 (the endpoint is gone).
 *
 * Every safety net in this file and its callers watched for the second. So the
 * first produced a permanent, invisible outage: rows kept, device count still
 * reassuringly non-zero, Settings still reading "You'll get alerts here", the
 * "your device went quiet" email never sent, and the client's boot-time sync
 * dutifully re-registering the dead subscription every single morning.
 */
describe("a VAPID key that has moved on", () => {
  const KEY_HASH = require("node:crypto").createHash("sha256").update("PUB").digest("hex");

  test("a subscription stamped with a superseded key is dropped WITHOUT a send", async () => {
    const client = makeClient([{ ...SUB, vapid_key_hash: "some-older-key-hash" }]);
    const out = await push.sendToUser(client, { user_id: "u-1", title: "T" });

    expect(mockSendNotification).not.toHaveBeenCalled();
    expect(out).toMatchObject({ sent: 0, failed: 0, pruned: 1, stale: 1 });
    // Counted as `pruned`, which is what deliverOutbound already watches to
    // send the lapse email — the user is unreachable, and that is the same
    // fact whether the endpoint died or the key did.
    expect(client.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM push_subscription/),
      [SUB.endpoint],
    );
    expect(out.reason).toBe("devices registered under a superseded key");
  });

  test("a subscription stamped with the CURRENT key is sent to as normal", async () => {
    const out = await push.sendToUser(
      makeClient([{ ...SUB, vapid_key_hash: KEY_HASH }]),
      { user_id: "u-1", title: "T" },
    );
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ sent: 1, pruned: 0, stale: 0 });
  });

  test("an unstamped row (subscribed before 12770) is attempted, and a 403 drops it", async () => {
    // The only way to classify these is to let the push service answer. 403 is
    // "your signature is not welcome here", which is not the same as gone —
    // but it is just as permanent, so it prunes and counts like gone.
    const client = makeClient([{ ...SUB, vapid_key_hash: null }]);
    mockSendNotification.mockRejectedValueOnce(
      Object.assign(new Error("forbidden"), { statusCode: 403 }),
    );
    const out = await push.sendToUser(client, { user_id: "u-1", title: "T" });

    expect(out).toMatchObject({ sent: 0, failed: 0, pruned: 1, stale: 1 });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM push_subscription/),
      [SUB.endpoint],
    );
  });

  test("a 401 that names VAPID is the same case; a 401 that does not is an ordinary failure", async () => {
    mockSendNotification.mockRejectedValueOnce(
      Object.assign(new Error("invalid vapid jwt"), { statusCode: 401 }),
    );
    expect(await push.sendToUser(makeClient([{ ...SUB, vapid_key_hash: null }]), {
      user_id: "u-1", title: "T",
    })).toMatchObject({ pruned: 1, failed: 0 });

    mockSendNotification.mockRejectedValueOnce(
      Object.assign(new Error("rate limited"), { statusCode: 401 }),
    );
    expect(await push.sendToUser(makeClient([{ ...SUB, vapid_key_hash: null }]), {
      user_id: "u-1", title: "T",
    })).toMatchObject({ pruned: 0, failed: 1 });
  });

  test("a platform store that is DOWN never causes a prune", async () => {
    /*
     * The key resolution falls back to the env keypair when the platform store
     * is unreachable — silently, on a path that looks like success. If the
     * fallback key differed from the stored one, treating a fingerprint
     * mismatch as authoritative would delete every subscription on the deploy
     * during a five-second database blip, and manufacture the exact outage
     * this whole mechanism exists to repair.
     */
    const settings = require("../../src/services/platform/settings.service");
    settings.resolve.mockRejectedValue(new Error("platform db unreachable"));
    const client = makeClient([{ ...SUB, vapid_key_hash: "a-different-key-hash" }]);

    const out = await push.sendToUser(client, { user_id: "u-1", title: "T" });

    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM push_subscription/),
      expect.anything(),
    );
    expect(out).toMatchObject({ sent: 1, stale: 0 });
    settings.resolve.mockResolvedValue(null);
  });

  test("a successful send stamps last_used_at — the column meant 'last registered' before", async () => {
    const client = makeClient([{ ...SUB, vapid_key_hash: KEY_HASH }]);
    await push.sendToUser(client, { user_id: "u-1", title: "T" });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringMatching(/SET last_used_at = now\(\)/),
      [SUB.endpoint],
    );
  });
});

describe("degrading cleanly", () => {
  test("no registered device is reported as such, so the caller can fall back to email", async () => {
    const out = await push.sendToUser(makeClient([]), { user_id: "u-1", title: "T" });
    expect(out).toEqual({ sent: 0, failed: 0, total: 0, pruned: 0, reason: "no registered devices" });
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  test("an unprovisioned table is a reason, never a throw into the notification path", async () => {
    const client = { query: jest.fn(async () => { throw new Error('relation "push_subscription" does not exist'); }) };
    const out = await push.sendToUser(client, { user_id: "u-1", title: "T" });
    expect(out.reason).toBe("no push_subscription table");
  });
});
