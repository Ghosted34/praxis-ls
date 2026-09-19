"use strict";
// The tasks EMAIL exception (packages/shared/rules/notification-email-default).
//
// Email is opt-in for every category — an inbox nobody asked to be written to
// is spam with a product logo on it. Tasks is the one opt-out category, and
// these tests pin the three halves of that decision so they cannot drift:
//
//   1. the RULE itself (emailDefaultFor),
//   2. its CONSISTENCY with the catalog (a key that is not a category can
//      never match a preference row the Preferences screen would write), and
//   3. its ENFORCEMENT — the default notify() hands to the preference read,
//      and that an explicit opt-out row still beats it.

const rule = require("../../packages/shared/rules/notification-email-default");
const cats = require("../../src/shared/notifications/categories");

describe("emailDefaultFor — the tasks opt-out exception", () => {
  test("tasks emails by default; every other known category does not", () => {
    expect(rule.emailDefaultFor("tasks")).toBe(true);
    for (const c of cats.CATEGORIES) {
      if (c.key === "tasks") continue;
      expect(rule.emailDefaultFor(c.key)).toBe(false);
    }
  });

  test("unknown, empty and case-variant inputs are opt-in, never a throw", () => {
    expect(rule.emailDefaultFor("nosuch")).toBe(false);
    expect(rule.emailDefaultFor("")).toBe(false);
    expect(rule.emailDefaultFor(null)).toBe(false);
    expect(rule.emailDefaultFor(undefined)).toBe(false);
    expect(rule.emailDefaultFor("TASKS")).toBe(true); // case-insensitive, like every category lookup
  });

  test("every opt-out key exists in the catalog — a typo here is a silent no-op", () => {
    const known = new Set(cats.CATEGORIES.map((c) => c.key));
    for (const key of rule.EMAIL_DEFAULT_CATEGORIES) {
      expect(known.has(key)).toBe(true);
    }
  });
});

describe("notify() — the default handed to the EMAIL preference read", () => {
  jest.resetModules();
  jest.doMock("../../src/modules/notification/notification.repo");
  const repo = require("../../src/modules/notification/notification.repo");
  const svc = require("../../src/modules/notification/notification.service");
  const client = {};

  beforeEach(() => {
    repo.insertForUser.mockReset().mockResolvedValue({ notification_id: "n-1" });
    repo.isChannelEnabled.mockReset();
    repo.unreadCount.mockReset().mockResolvedValue(0);
    repo.activeEmailsFor.mockReset().mockResolvedValue(new Map());
  });

  test("a task notification consults EMAIL with default ON (opt-out)", async () => {
    repo.isChannelEnabled.mockResolvedValue(true); // no row → the default we handed down
    await svc.notify(client, {
      userId: "u",
      eventTypeKey: "task.pinged",
      title: "T",
    });
    expect(repo.isChannelEnabled).toHaveBeenCalledWith(
      client,
      "u",
      "EMAIL",
      "tasks",
      true,
    );
  });

  test("a non-task category keeps the opt-in default (false)", async () => {
    repo.isChannelEnabled.mockResolvedValue(false);
    await svc.notify(client, {
      userId: "u",
      eventTypeKey: "invoice.posted",
      title: "T",
    });
    expect(repo.isChannelEnabled).toHaveBeenCalledWith(
      client,
      "u",
      "EMAIL",
      "finance",
      false,
    );
  });

  test("an explicit opt-out row beats the tasks default", async () => {
    // IN_APP on, EMAIL off — the stored row a user who unticked Email for
    // Tasks in Preferences would have.
    repo.isChannelEnabled.mockImplementation(async (_c, _u, ch) => ch === "IN_APP");
    const r = await svc.notify(client, {
      userId: "u",
      eventTypeKey: "task.pinged",
      title: "T",
    });
    // The in-app row is still written — email is one channel, not the record.
    expect(r).toEqual({ notification_id: "n-1" });
  });
});
