"use strict";
/**
 * The ring job (calls audit PR-4): "ring" sends one ring push and carries its
 * alert number, "cancel" replaces the ring, and a PR-3 "escalate" job still
 * queued across the deploy runs as the ring at dial.
 */
jest.mock("../../src/services/tenant/registry.service", () => ({
  withTenantConnection: jest.fn(async (_meta, _env, fn) => fn({ query: async () => ({ rows: [] }) })),
}));
const callService = require("../../src/modules/smartcomm/smartcomm.call.service");
const handler = require("../../src/jobs/handlers/comms-call-ring-escalate");

const META = { slug: "acme" };
beforeEach(() => {
  jest.spyOn(callService, "ringPush").mockResolvedValue({ pushed: true });
  jest.spyOn(callService, "ringCancel").mockResolvedValue({ pushed: true });
});
afterEach(() => jest.restoreAllMocks());

test("a ring job pushes that alert, and can queue the next (it gets the tenant)", async () => {
  await handler({ name: "ring", data: { callId: "c1", tenantMeta: META, env: "sandbox", alert: 2 } });
  expect(callService.ringPush.mock.calls[0][1]).toEqual({ callId: "c1", alert: 2, tenantSlug: "acme", tenantMeta: META, env: "sandbox" });
  expect(callService.ringCancel).not.toHaveBeenCalled();
});

test("a cancel job replaces the ring with the outcome it carries", async () => {
  await handler({ name: "cancel", data: { callId: "c1", tenantMeta: META, env: "live", outcome: "answered" } });
  expect(callService.ringCancel.mock.calls[0][1]).toEqual({ callId: "c1", outcome: "answered", tenantSlug: "acme" });
  expect(callService.ringPush).not.toHaveBeenCalled();
});

test("a PR-3 escalation still queued at deploy runs as the ring at dial", async () => {
  await handler({ name: "escalate", data: { callId: "c1", tenantMeta: META, env: "live" } });
  expect(callService.ringPush.mock.calls[0][1]).toMatchObject({ callId: "c1", alert: 0 });
});

test("a job without a tenant or a call is refused", async () => {
  await expect(handler({ name: "ring", data: { callId: "c1", env: "live" } })).rejects.toThrow(/tenant/);
  await expect(handler({ name: "ring", data: { tenantMeta: META, env: "live" } })).rejects.toThrow(/call id/);
});
