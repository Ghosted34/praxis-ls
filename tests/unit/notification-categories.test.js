"use strict";
// Notification category catalog + preference enforcement (doc/PLAN §4.2).
// categoryFor is pure; notify() enforcement is tested with a mocked repo so we
// prove security bypasses preferences while other categories honour opt-outs.

const cats = require("../../src/shared/notifications/categories");

describe("categoryFor — event domain → category", () => {
  test.each([
    ["auth.password_reset_completed", "security"],
    ["permission.changed", "security"],
    ["role.changed", "security"],
    ["invoice.posted", "finance"],
    ["payment.received", "finance"],
    ["vehicle.insurance.expiring", "operations"],
    ["employee.created", "operations"],
    // MOD-00A — every task.* event files under its own bucket, not "system":
    // the people a ping must reach need a switch they can find.
    ["task.pinged", "tasks"],
    ["task.assigned", "tasks"],
    ["task.status_changed", "tasks"],
    ["task.reminder_due", "tasks"],
    // Calendar events are NOT tasks: a diary invitation is a different thing to
    // tune than work somebody is owed, and folding both under "tasks" would
    // make one switch govern two meanings.
    ["calendar_event.created", "system"],
    ["client.created", "sales"],
    ["campaign.created", "sales"],
    ["document.signed", "compliance"],
    ["approval.opened", "approvals"],
    ["ai.action.executed", "system"],
    ["totally.unknown", "system"],
    ["", "system"],
  ])("%s → %s", (key, expected) => {
    expect(cats.categoryFor(key)).toBe(expected);
  });

  test("security categories are flagged unconditional", () => {
    expect(cats.isSecurityCategory("security")).toBe(true);
    expect(cats.isSecurityCategory("finance")).toBe(false);
  });

  test("catalog exposes a locked security category", () => {
    expect(cats.CATEGORIES.find((c) => c.key === "security")).toMatchObject({
      security: true,
    });
  });

  test("tasks is its own tunable category, not a corner of System", () => {
    const tasks = cats.CATEGORIES.find((c) => c.key === "tasks");
    expect(tasks).toMatchObject({ label: "Tasks", security: false });
    // It appears in the catalog exactly once, like every row the Preferences
    // table renders — a duplicate key would render two switches for one truth.
    expect(cats.CATEGORIES.filter((c) => c.key === "tasks")).toHaveLength(1);
  });
});

describe("notify() — preference enforcement", () => {
  jest.resetModules();
  jest.doMock("../../src/modules/notification/notification.repo");
  const repo = require("../../src/modules/notification/notification.repo");
  const svc = require("../../src/modules/notification/notification.service");
  const client = {};

  beforeEach(() => {
    repo.insertForUser.mockReset();
    repo.isChannelEnabled.mockReset();
    repo.insertForUser.mockResolvedValue({ notification_id: "n-1" });
  });

  test("security notification is written WITHOUT consulting preferences", async () => {
    await svc.notify(client, {
      userId: "u",
      eventTypeKey: "auth.password_reset_completed",
      title: "T",
    });
    expect(repo.isChannelEnabled).not.toHaveBeenCalled();
    expect(repo.insertForUser).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ category: "security" }),
    );
  });

  test("opted-out non-security category is suppressed (no insert)", async () => {
    repo.isChannelEnabled.mockResolvedValue(false);
    const r = await svc.notify(client, {
      userId: "u",
      eventTypeKey: "invoice.posted",
      title: "Invoice",
    });
    expect(r).toBeNull();
    expect(repo.isChannelEnabled).toHaveBeenCalledWith(
      client,
      "u",
      "IN_APP",
      "finance",
    );
    expect(repo.insertForUser).not.toHaveBeenCalled();
  });

  test("allowed non-security category is written with its derived tag", async () => {
    repo.isChannelEnabled.mockResolvedValue(true);
    await svc.notify(client, {
      userId: "u",
      eventTypeKey: "vehicle.insurance.expiring",
      title: "Insurance",
    });
    expect(repo.insertForUser).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ category: "operations" }),
    );
  });
});
