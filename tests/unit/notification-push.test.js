"use strict";
// Web-Push opt-in service (doc/PLAN §4). Repo + VAPID resolution are mocked so we
// assert the service behaviour: a valid PushSubscription is stored for the caller,
// a malformed one is rejected, unsubscribe removes by endpoint, and the public
// key is surfaced from the deploy-wide VAPID identity.

jest.mock("../../src/modules/notification/notification.repo");
jest.mock("../../src/shared/push/push.service", () => ({
  getPublicKey: jest.fn(),
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
    await expect(
      svc.subscribePush(client, actor, { subscription, userAgent: "UA" }),
    ).resolves.toEqual({ subscribed: true });
    expect(repo.savePushSubscription).toHaveBeenCalledWith(client, "u-1", {
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
