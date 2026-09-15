"use strict";

/**
 * Which notifications are allowed to interrupt.
 *
 * ── WHY THIS MATTERS OPERATIONALLY ─────────────────────────────────────────
 *
 * Every notification used to arrive with identical weight: a number on a bell,
 * refreshed by a 60-second poll that pauses on a hidden tab. A cash request
 * awaiting approval and an invoice posted looked and sounded the same, because
 * neither made a sound. The reported cost was an approval nobody knew about.
 *
 * These pin the three things that decide whether the phone buzzes, and each of
 * them is easy to "simplify" into either silence or a flood.
 */

const mockInsertForUser = jest.fn(async () => ({ notification_id: "n-1" }));
const mockInsertForUsers = jest.fn(async () => [{ notification_id: "n-1", user_id: "u-1" }]);
const mockPushSend = jest.fn(async () => ({ sent: 1 }));
const mockIsChannelEnabled = jest.fn(async () => true);
const mockPreferencesFor = jest.fn(async () => new Map());
const mockPublishToUser = jest.fn();

jest.mock("../../src/modules/notification/notification.repo", () => ({
  insertForUser: (...a) => mockInsertForUser(...a),
  insertForUsers: (...a) => mockInsertForUsers(...a),
  isChannelEnabled: (...a) => mockIsChannelEnabled(...a),
  preferencesFor: (...a) => mockPreferencesFor(...a),
  activeEmailsFor: jest.fn(async () => new Map()),
  unreadCount: jest.fn(async () => 0),
  unreadCountsFor: jest.fn(async () => new Map()),
  listPushSubscriptions: jest.fn(async () => []),
}));
jest.mock("../../src/shared/push/push.service", () => ({
  sendToUser: (...a) => mockPushSend(...a),
  getPublicKey: jest.fn(async () => "k"),
}));
jest.mock("../../src/services/email.service", () => ({ send: jest.fn(async () => ({})) }));
jest.mock("../../src/realtime", () => ({
  publishToUser: (...a) => mockPublishToUser(...a),
  publish: jest.fn(),
}));
jest.mock("../../src/config/request-context", () => ({
  get: () => ({ requestId: "r-1" }),
  getTenant: () => "acme",
}));

const svc = require("../../src/modules/notification/notification.service");
const { notificationInterrupt } = require("@praxis/shared");

const DB = { query: jest.fn(async () => ({ rows: [] })) };
const pushArgs = () => mockPushSend.mock.calls.at(-1)[1];
const liveArgs = () => mockPublishToUser.mock.calls.at(-1);

beforeEach(() => {
  jest.clearAllMocks();
  mockIsChannelEnabled.mockImplementation(async (_c, _u, ch) => (ch === "INTERRUPT" ? null : true));
  mockPreferencesFor.mockImplementation(async () => new Map());
});

describe("the default set", () => {
  it("interrupts for approvals, comms and anything HIGH", () => {
    expect(notificationInterrupt.defaultInterrupt({ priority: "NORMAL", category: "approvals" })).toBe(true);
    expect(notificationInterrupt.defaultInterrupt({ priority: "NORMAL", category: "comms" })).toBe(true);
    expect(notificationInterrupt.defaultInterrupt({ priority: "HIGH", category: "finance" })).toBe(true);
  });

  it("stays quiet for routine traffic", () => {
    // The reason the default is not "everything": a channel that interrupts for
    // an posted invoice gets muted wholesale, and a muted channel is the
    // original bug reached by a different road.
    expect(notificationInterrupt.defaultInterrupt({ priority: "NORMAL", category: "finance" })).toBe(false);
    expect(notificationInterrupt.defaultInterrupt({ priority: "NORMAL", category: "operations" })).toBe(false);
  });
});

describe("a user's own preference wins", () => {
  it("silences a category even when the notification is HIGH", async () => {
    // Deliberate: someone who said "never interrupt me about approvals" said it
    // about the urgent ones too. Quietly overriding them is how people stop
    // trusting the switch.
    expect(notificationInterrupt.interruptFor({ priority: "HIGH", category: "approvals", preference: false })).toBe(false);
  });

  it("raises a category that is quiet by default", async () => {
    expect(notificationInterrupt.interruptFor({ priority: "NORMAL", category: "finance", preference: true })).toBe(true);
  });

  it("is read per recipient in the batch fan-out", async () => {
    // Two people, opposite preferences, one event. The one who silenced it must
    // not hear the other's tone.
    mockPreferencesFor.mockImplementation(async () => new Map([["u-2:INTERRUPT", false]]));
    mockInsertForUsers.mockResolvedValue([
      { notification_id: "n-1", user_id: "u-1" },
      { notification_id: "n-2", user_id: "u-2" },
    ]);
    await svc.notifyMany(DB, ["u-1", "u-2"], {
      title: "Cash request approved", category: "approvals", priority: "NORMAL",
    });
    const byUser = Object.fromEntries(
      mockPublishToUser.mock.calls.map(([, uid, , p]) => [uid, p.interrupt]),
    );
    expect(byUser["u-1"]).toBe(true);
    expect(byUser["u-2"]).toBe(false);
  });
});

describe("what reaches the device", () => {
  it("sets requireInteraction and vibrate for an interrupt", async () => {
    await svc.notify(DB, { userId: "u-1", title: "Awaiting your approval", category: "approvals" });
    expect(pushArgs().requireInteraction).toBe(true);
    expect(pushArgs().vibrate).toEqual([200, 100, 200]);
  });

  it("sends no vibration for routine traffic", async () => {
    // A phone that buzzes for a posted invoice is a phone whose owner turns the
    // whole channel off.
    await svc.notify(DB, { userId: "u-1", title: "Invoice posted", category: "finance" });
    expect(pushArgs().vibrate).toBeNull();
    expect(pushArgs().requireInteraction).toBeFalsy();
  });
});

describe("the live announcement", () => {
  it("reaches the recipient's own room, not the tenant", async () => {
    // "Your cash request was rejected" is not everyone's business. The room is
    // derived server-side from the authenticated user id.
    await svc.notify(DB, { userId: "u-1", title: "Cash request rejected", category: "approvals" });
    const [slug, userId, event, payload] = liveArgs();
    expect(slug).toBe("acme");
    expect(userId).toBe("u-1");
    expect(event).toBe("notification:new");
    expect(payload).toMatchObject({ notification_id: "n-1", interrupt: true });
  });

  it("carries the link so the toast can point somewhere", async () => {
    await svc.notify(DB, { userId: "u-1", title: "New lead", entityRef: "lead:42", category: "sales" });
    expect(liveArgs()[3].link_url).toBe("/sales/leads/42");
  });

  it("never fails the notification when the socket layer throws", async () => {
    // The row is already committed; a realtime enrichment must not undo it.
    mockPublishToUser.mockImplementation(() => { throw new Error("socket down"); });
    await expect(
      svc.notify(DB, { userId: "u-1", title: "Awaiting your approval", category: "approvals" }),
    ).resolves.toBeTruthy();
  });
});
