"use strict";
// Domain-event notifications to RBAC permission-holders (doc/PLAN §4). Curated
// allowlist + best-effort. Repo + producer mocked so we prove audience resolution
// (module permission-holders minus the actor), allowlist gating, and safety.

jest.mock("../../src/modules/notification/notification.repo");
jest.mock("../../src/modules/notification/notification.service");

const repo = require("../../src/modules/notification/notification.repo");
const service = require("../../src/modules/notification/notification.service");
const ne = require("../../src/shared/notifications/notify-events");

const client = {};

beforeEach(() => {
  repo.recipientsWithPermission.mockReset();
  service.notify.mockReset().mockResolvedValue({ notification_id: "n" });
});

test("allowlisted finance event notifies module permission-holders (view), excluding the actor", async () => {
  repo.recipientsWithPermission.mockResolvedValue(["fin1", "fin2", "actor"]);
  const sent = await ne.onEvent(client, {
    eventTypeKey: "payment.received", moduleKey: "MOD-51",
    entityRef: "payment:abcd1234eeee", actorUserId: "actor", payload: { amount_xaf: 250000 },
  });
  expect(sent).toBe(2);
  expect(repo.recipientsWithPermission).toHaveBeenCalledWith(client, "MOD-51", "view");
  expect(service.notify.mock.calls.map((c) => c[1].userId)).toEqual(["fin1", "fin2"]);
  expect(service.notify.mock.calls[0][1]).toMatchObject({ category: "finance", title: "Payment received" });
  expect(service.notify.mock.calls[0][1].body).toMatch(/250,000 XAF/);
});

test("non-allowlisted event is a no-op (no query, no notify)", async () => {
  const sent = await ne.onEvent(client, { eventTypeKey: "attendance.clocked_in", moduleKey: "MOD-70", entityRef: "att:1" });
  expect(sent).toBe(0);
  expect(repo.recipientsWithPermission).not.toHaveBeenCalled();
  expect(service.notify).not.toHaveBeenCalled();
});

test("missing module key is a no-op", async () => {
  expect(await ne.onEvent(client, { eventTypeKey: "invoice.posted", moduleKey: null })).toBe(0);
  expect(repo.recipientsWithPermission).not.toHaveBeenCalled();
});

test("is best-effort: a producer failure is swallowed", async () => {
  repo.recipientsWithPermission.mockResolvedValue(["fin1"]);
  service.notify.mockRejectedValue(new Error("boom"));
  await expect(ne.onEvent(client, { eventTypeKey: "invoice.posted", moduleKey: "MOD-51", entityRef: "invoice:1" })).resolves.toBe(0);
});
