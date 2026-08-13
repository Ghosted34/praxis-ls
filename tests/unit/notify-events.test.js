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

// PERF S5 replaced the per-recipient `notify` loop with ONE batched
// `notifyMany` call, and this file was never updated — it kept asserting
// `service.notify`, which the code no longer calls. Under the auto-mock that
// made `onEvent` return undefined and the assertions fail against `undefined`
// rather than against a wrong value, so it read like a product bug.
beforeEach(() => {
  repo.recipientsWithPermission.mockReset();
  service.notifyMany
    .mockReset()
    .mockImplementation(async (c, ids) => (ids || []).length);
});

test("allowlisted finance event notifies module permission-holders (view), excluding the actor", async () => {
  repo.recipientsWithPermission.mockResolvedValue(["fin1", "fin2", "actor"]);
  const sent = await ne.onEvent(client, {
    eventTypeKey: "payment.received",
    moduleKey: "MOD-51",
    entityRef: "payment:abcd1234eeee",
    actorUserId: "actor",
    payload: { amount_xaf: 250000 },
  });
  expect(sent).toBe(2);
  expect(repo.recipientsWithPermission).toHaveBeenCalledWith(
    client,
    "MOD-51",
    "view",
  );
  // ONE batched call, and the actor is excluded from its recipient list —
  // "do not tell me about my own action" is this fan-out's rule.
  expect(service.notifyMany).toHaveBeenCalledTimes(1);
  expect(service.notifyMany.mock.calls[0][1]).toEqual(["fin1", "fin2"]);
  expect(service.notifyMany.mock.calls[0][2]).toMatchObject({
    category: "finance",
    title: "Payment received",
  });
  expect(service.notifyMany.mock.calls[0][2].body).toMatch(/250,000 XAF/);
});

test("non-allowlisted event is a no-op (no query, no notify)", async () => {
  const sent = await ne.onEvent(client, {
    eventTypeKey: "attendance.clocked_in",
    moduleKey: "MOD-70",
    entityRef: "att:1",
  });
  expect(sent).toBe(0);
  expect(repo.recipientsWithPermission).not.toHaveBeenCalled();
  expect(service.notifyMany).not.toHaveBeenCalled();
});

test("missing module key is a no-op", async () => {
  expect(
    await ne.onEvent(client, {
      eventTypeKey: "invoice.posted",
      moduleKey: null,
    }),
  ).toBe(0);
  expect(repo.recipientsWithPermission).not.toHaveBeenCalled();
});

test("is best-effort: a producer failure is swallowed", async () => {
  repo.recipientsWithPermission.mockResolvedValue(["fin1"]);
  service.notifyMany.mockRejectedValue(new Error("boom"));
  await expect(
    ne.onEvent(client, {
      eventTypeKey: "invoice.posted",
      moduleKey: "MOD-51",
      entityRef: "invoice:1",
    }),
  ).resolves.toBe(0);
});
