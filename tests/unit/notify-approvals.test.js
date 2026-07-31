"use strict";
// Approval-flow notifications (doc/PLAN §4 — first real events through notify()).
// The notification repo + producer are mocked so we prove recipient resolution
// and that the whole thing is best-effort (never throws into the approval flow).

jest.mock("../../src/modules/notification/notification.repo");
jest.mock("../../src/modules/notification/notification.service");

const repo = require("../../src/modules/notification/notification.repo");
const service = require("../../src/modules/notification/notification.service");
const na = require("../../src/services/workflow/notify-approvals");

const client = {};

beforeEach(() => {
  repo.roleRecipients.mockReset();
  repo.requesterFor.mockReset();
  service.notify.mockReset().mockResolvedValue({ notification_id: "n" });
});

describe("onTaskOpened", () => {
  test("notifies every active role holder except the triggering actor", async () => {
    repo.roleRecipients.mockResolvedValue(["a", "b", "actor"]);
    const sent = await na.onTaskOpened(client, { entityRef: "invoice:9f8c1234deadbeef", roleId: "r1", amountXaf: 1500000, excludeUserId: "actor" });
    expect(sent).toBe(2);
    expect(service.notify).toHaveBeenCalledTimes(2);
    expect(service.notify.mock.calls.map((c) => c[1].userId)).toEqual(["a", "b"]);
    expect(service.notify.mock.calls[0][1]).toMatchObject({ category: "approvals", eventTypeKey: "approval.pending" });
    expect(service.notify.mock.calls[0][1].body).toMatch(/Invoice 9f8c1234 is awaiting your approval — 1,500,000 XAF/);
  });

  test("no role → no notifications", async () => {
    expect(await na.onTaskOpened(client, { entityRef: "x:1", roleId: null })).toBe(0);
    expect(service.notify).not.toHaveBeenCalled();
  });

  test("is best-effort: a producer failure is swallowed", async () => {
    repo.roleRecipients.mockResolvedValue(["a"]);
    service.notify.mockRejectedValue(new Error("boom"));
    await expect(na.onTaskOpened(client, { entityRef: "x:1", roleId: "r1" })).resolves.toBe(0);
  });
});

describe("onOutcome", () => {
  test("notifies the requester on approval (NORMAL)", async () => {
    repo.requesterFor.mockResolvedValue("req");
    await na.onOutcome(client, { entityRef: "invoice:9f8c1234", approved: true, actorUserId: "appr" });
    expect(service.notify).toHaveBeenCalledWith(client, expect.objectContaining({ userId: "req", eventTypeKey: "approval.approved", priority: "NORMAL" }));
  });

  test("notifies the requester on rejection (HIGH)", async () => {
    repo.requesterFor.mockResolvedValue("req");
    await na.onOutcome(client, { entityRef: "invoice:9f8c1234", approved: false, actorUserId: "appr" });
    expect(service.notify).toHaveBeenCalledWith(client, expect.objectContaining({ eventTypeKey: "approval.rejected", priority: "HIGH" }));
  });

  test("skips when the requester is the actor (self-decided) or unknown", async () => {
    repo.requesterFor.mockResolvedValue("self");
    expect(await na.onOutcome(client, { entityRef: "x:1", approved: true, actorUserId: "self" })).toBe(0);
    repo.requesterFor.mockResolvedValue(null);
    expect(await na.onOutcome(client, { entityRef: "x:1", approved: true, actorUserId: "a" })).toBe(0);
    expect(service.notify).not.toHaveBeenCalled();
  });
});
