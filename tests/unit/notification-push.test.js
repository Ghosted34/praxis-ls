"use strict";
// Web-Push opt-in service (doc/PLAN §4). Repo + VAPID resolution are mocked so we
// assert the service behaviour: a valid PushSubscription is stored for the caller,
// a malformed one is rejected, unsubscribe removes by endpoint, and the public
// key is surfaced from the deploy-wide VAPID identity.

jest.mock("../../src/modules/notification/notification.repo");
jest.mock("../../src/shared/push/push.service", () => ({
  getPublicKey: jest.fn(),
  sendToUser: jest.fn(),
  // 12770: a subscription is stamped with the key it was minted under, so a
  // later send can recognise one that belongs to a key we have rotated away
  // from — the case push services answer with 403, not 410.
  currentKeyFingerprint: jest.fn(async () => "KEYHASH"),
}));

const repo = require("../../src/modules/notification/notification.repo");
const push = require("../../src/shared/push/push.service");
const svc = require("../../src/modules/notification/notification.service");

const actor = { user_id: "u-1" };
const client = {};

describe("notification push opt-in", () => {
  test("pushPublicKey surfaces the VAPID public key", async () => {
    push.getPublicKey.mockResolvedValue("VAPID_PUB");
    await expect(svc.pushPublicKey()).resolves.toEqual({
      public_key: "VAPID_PUB",
    });
  });

  test("subscribePush stores endpoint + keys for the caller", async () => {
    repo.savePushSubscription.mockResolvedValue({ subscription_id: "s-1" });
    const subscription = {
      endpoint: "https://push.example/abc",
      keys: { p256dh: "k1", auth: "k2" },
    };
    // Also returns a single-use ROTATION TOKEN now — what the service worker
    // presents to re-register this device when the browser rotates its
    // subscription, since a worker has no session to authenticate with.
    // Covered in depth by push-rotation.test.js; asserted as present here so
    // the opt-in contract cannot lose it.
    const out = await svc.subscribePush(client, actor, { subscription, userAgent: "UA" });
    expect(out).toMatchObject({ subscribed: true });
    expect(out).toHaveProperty("rotation_token");
    expect(repo.savePushSubscription).toHaveBeenCalledWith(client, "u-1", {
      vapidKeyHash: "KEYHASH",
      endpoint: "https://push.example/abc",
      p256dh: "k1",
      auth: "k2",
      userAgent: "UA",
    });
  });

  test("subscribePush rejects a malformed subscription (422)", async () => {
    await expect(
      svc.subscribePush(client, actor, { subscription: { endpoint: "x" } }),
    ).rejects.toMatchObject({ code: "INVALID_SUBSCRIPTION", status: 422 });
    expect(repo.savePushSubscription).not.toHaveBeenCalled();
  });

  test("unsubscribePush removes the endpoint for the caller", async () => {
    repo.deletePushSubscription.mockResolvedValue(1);
    await expect(
      svc.unsubscribePush(client, actor, {
        endpoint: "https://push.example/abc",
      }),
    ).resolves.toEqual({ unsubscribed: true });
    expect(repo.deletePushSubscription).toHaveBeenCalledWith(
      client,
      "u-1",
      "https://push.example/abc",
    );
  });
});

/*
 * ── WHY A SELF-TEST IS A PRODUCT FEATURE ────────────────────────────────────
 *
 * Every failure in this path is silent by design — a notification must never
 * be able to fail the operation that raised it. The cost is a chain (keypair,
 * subscription, key still current, push service, service worker, OS) where a
 * break anywhere looks exactly like "nothing happened", to a tenant admin with
 * no access to a log. Until this existed, the only surfaces reporting on push
 * were a browser permission flag and a row count, and BOTH read healthy during
 * a total outage.
 */
describe("the push self-test", () => {
  test("sends through the real delivery path, to the caller and nobody else", async () => {
    push.sendToUser.mockResolvedValue({ sent: 1, failed: 0, total: 1, pruned: 0, stale: 0 });
    repo.countPushSubscriptions.mockResolvedValue(1);

    const out = await svc.sendPushTest(client, actor);

    expect(push.sendToUser).toHaveBeenCalledWith(client, expect.objectContaining({
      user_id: "u-1",
      urgency: "high",
    }));
    expect(out).toMatchObject({ ok: true, sent: 1, devices: 1 });
  });

  test("nothing delivered is reported as a failure, carrying the reason to show", async () => {
    push.sendToUser.mockResolvedValue({
      sent: 0, failed: 0, total: 0, pruned: 0, reason: "push not configured",
    });
    repo.countPushSubscriptions.mockResolvedValue(0);

    const out = await svc.sendPushTest(client, actor);
    expect(out).toMatchObject({ ok: false, reason: "push not configured", devices: 0 });
  });
});

describe("what the server can see of a user's devices", () => {
  test("a device on a superseded key is counted as such — 'registered' is not 'reachable'", async () => {
    // The whole point. A row count answered "1 device" with equal confidence
    // whether that device was receiving everything or nothing.
    push.currentKeyFingerprint.mockResolvedValue("CURRENT");
    repo.countPushSubscriptions.mockResolvedValue(2);
    repo.listPushSubscriptions.mockResolvedValue([
      { endpoint: "https://fcm.example/a", user_agent: "Android", vapid_key_hash: "CURRENT",
        created_at: "2026-01-01", last_used_at: "2026-02-01", last_failed_at: null, last_error: null },
      { endpoint: "https://fcm.example/b", user_agent: "Firefox", vapid_key_hash: "OLD",
        created_at: "2026-01-01", last_used_at: null, last_failed_at: null, last_error: null },
    ]);

    const out = await svc.pushDevices(client, actor);
    expect(out).toMatchObject({ devices: 2, superseded: 1, configured: true });
    expect(out.detail[0]).toMatchObject({ push_service: "fcm.example", superseded_key: false });
    expect(out.detail[1]).toMatchObject({ superseded_key: true });
  });

  test("the endpoint itself never leaves the server — it is a capability URL", async () => {
    push.currentKeyFingerprint.mockResolvedValue("CURRENT");
    repo.countPushSubscriptions.mockResolvedValue(1);
    repo.listPushSubscriptions.mockResolvedValue([
      { endpoint: "https://fcm.example/secret-capability", user_agent: null,
        vapid_key_hash: "CURRENT", created_at: "2026-01-01", last_used_at: null,
        last_failed_at: null, last_error: null },
    ]);

    const out = await svc.pushDevices(client, actor);
    expect(JSON.stringify(out)).not.toContain("secret-capability");
  });

  test("12770 not applied yet still answers the count the client has always asked for", async () => {
    push.getPublicKey.mockResolvedValue("VAPID_PUB");
    repo.countPushSubscriptions.mockResolvedValue(3);
    repo.listPushSubscriptions.mockRejectedValue(new Error('column "vapid_key_hash" does not exist'));

    await expect(svc.pushDevices(client, actor)).resolves.toMatchObject({ devices: 3, detail: null });
  });
});
