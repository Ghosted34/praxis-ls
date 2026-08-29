"use strict";
/**
 * The `notification-deliver` worker job — the retryable half of a notification.
 *
 * Before it existed, push and SMTP ran inline on the producer's connection
 * while its write transaction was still open, with no retry: a push service
 * answering 500 meant the notification was logged at warn level and lost. This
 * job is what makes a transient failure recoverable, so what it needs to
 * guarantee is that it (a) opens the right tenant's connection, (b) delivers
 * the plan it was handed rather than re-deriving one, and (c) THROWS on a
 * malformed job so BullMQ retries it instead of silently reporting success.
 */

const mockWithTenantConnection = jest.fn(async (_meta, _env, fn) => fn("CLIENT"));
const mockDeliverOutbound = jest.fn(async () => ({ pushed: 2, emailed: 1, fellBack: 1, recipients: 2 }));

jest.mock("../../src/services/tenant/registry.service", () => ({
  withTenantConnection: (...a) => mockWithTenantConnection(...a),
}));
jest.mock("../../src/modules/notification/notification.service", () => ({
  deliverOutbound: (...a) => mockDeliverOutbound(...a),
}));

const handler = require("../../src/jobs/handlers/notification-deliver");

const tenantMeta = { slug: "smartls", db_name: "praxis_smartls" };
const recipients = [
  { userId: "u-1", email: false, push: true, badgeCount: 3 },
  { userId: "u-2", email: true, push: true, badgeCount: 1 },
];
const notification = {
  title: "Ama Boateng", body: "Re: BL 4471", category: "comms",
  url: "/comms/mail?thread=t-1", tag: "mail:t-1", renotify: true,
  urgency: "high", emailFallback: true,
};

beforeEach(() => jest.clearAllMocks());

test("delivers the plan on that tenant's connection", async () => {
  const out = await handler({ data: { tenantMeta, env: "live", recipients, notification } });

  expect(mockWithTenantConnection).toHaveBeenCalledTimes(1);
  expect(mockWithTenantConnection.mock.calls[0][0]).toBe(tenantMeta);
  expect(mockWithTenantConnection.mock.calls[0][1]).toBe("live");
  // The plan is passed through untouched — recipients and preferences were
  // resolved against the transaction that wrote the in-app rows, and a retry
  // three minutes later must not disagree with what the user already sees.
  expect(mockDeliverOutbound).toHaveBeenCalledWith("CLIENT", { recipients, notification });
  expect(out).toMatchObject({ pushed: 2, emailed: 1 });
});

test("defaults to the live environment", async () => {
  await handler({ data: { tenantMeta, recipients, notification } });
  expect(mockWithTenantConnection.mock.calls[0][1]).toBe("live");
});

test("no tenant → throws, so BullMQ retries rather than reporting a success", async () => {
  await expect(handler({ data: { recipients, notification } })).rejects.toThrow(/tenantMeta/);
  expect(mockDeliverOutbound).not.toHaveBeenCalled();
});

test("a notification with no title throws — an empty banner is worse than none", async () => {
  await expect(
    handler({ data: { tenantMeta, recipients, notification: { body: "x" } } }),
  ).rejects.toThrow(/title/);
});

test("an empty recipient list is a no-op, not an error — nothing to retry", async () => {
  const out = await handler({ data: { tenantMeta, recipients: [], notification } });
  expect(out).toEqual({ pushed: 0, emailed: 0, recipients: 0 });
  expect(mockWithTenantConnection).not.toHaveBeenCalled();
});

test("the queue is registered on the worker runtime — an unregistered queue is a job that waits for ever", () => {
  const src = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../../src/jobs/workers.js"), "utf8",
  );
  expect(src).toMatch(/name:\s*"notification-deliver"/);
  expect(src).toMatch(/handlers\/notification-deliver/);
});
