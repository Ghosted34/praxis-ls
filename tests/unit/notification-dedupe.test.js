/**
 * Notification dedup (§7.4, addition f, §7.10).
 *
 * The rule, and it is a MUST: "One logical event produces at most one
 * notification per user per channel. Implement in `notification.service` as a
 * `dedupe_key` (`{category}:{source_ref}:{user_id}`) with a 60-second
 * suppression window ... MUST be applied in the service, not per caller."
 *
 * This file used to hold two assertions on `shouldDedupe` alone. Calling the
 * predicate proves the predicate; it does not prove that `notify()` consults it
 * before it touches a channel, and in particular it does not prove that PUSH is
 * suppressed as well as the in-app row — which is the version of this bug that
 * reaches a phone twice at 2am. Both are asserted below, through `notify()`.
 */
"use strict";

const mockInsertForUser = jest.fn(async () => ({ notification_id: "n-1" }));
const mockIsChannelEnabled = jest.fn(async () => true);
const mockPushSend = jest.fn(async () => ({ sent: 1 }));

jest.mock("../../src/modules/notification/notification.repo", () => ({
  insertForUser: (...a) => mockInsertForUser(...a),
  insertForUsers: jest.fn(async () => 0),
  isChannelEnabled: (...a) => mockIsChannelEnabled(...a),
  preferencesFor: jest.fn(async () => new Map()),
  activeEmailsFor: jest.fn(async () => new Map()),
  listPushSubscriptions: jest.fn(async () => []),
  deletePushSubscription: jest.fn(async () => ({})),
  savePushSubscription: jest.fn(async () => ({})),
  unreadCount: jest.fn(async () => 0),
}));
jest.mock("../../src/shared/push/push.service", () => ({
  sendToUser: (...a) => mockPushSend(...a),
  getPublicKey: jest.fn(async () => "vapid-pub"),
}));
jest.mock("../../src/services/email.service", () => ({ send: jest.fn(async () => ({})) }));

const notifications = require("../../src/modules/notification/notification.service");

const DB = { query: jest.fn(async () => ({ rows: [] })) };
const base = (over = {}) => ({
  userId: "u-1", title: "You were mentioned", body: "x",
  entityRef: "email_thread:t-1", category: "MENTION", ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockIsChannelEnabled.mockResolvedValue(true);
  mockInsertForUser.mockResolvedValue({ notification_id: "n-1" });
  notifications.recentDedupe.clear();
});

describe("the window suppresses a repeat of the same logical event", () => {
  test("the first call delivers, the second inside the window does not", async () => {
    const first = await notifications.notify(DB, base({ dedupeKey: "MENTION:note-1:u-1" }));
    const second = await notifications.notify(DB, base({ dedupeKey: "MENTION:note-1:u-1" }));
    expect(first).toBeTruthy();
    expect(second).toBeNull();
    expect(mockInsertForUser).toHaveBeenCalledTimes(1);
  });

  test("suppression covers PUSH too, not only the in-app row", async () => {
    await notifications.notify(DB, base({ dedupeKey: "MENTION:note-1:u-1" }));
    await notifications.notify(DB, base({ dedupeKey: "MENTION:note-1:u-1" }));
    expect(mockPushSend).toHaveBeenCalledTimes(1);
  });

  test("it returns BEFORE any channel is consulted, not after each one decides", async () => {
    await notifications.notify(DB, base({ dedupeKey: "K" }));
    mockIsChannelEnabled.mockClear();
    await notifications.notify(DB, base({ dedupeKey: "K" }));
    expect(mockIsChannelEnabled).not.toHaveBeenCalled();
  });
});

describe("what is NOT the same event", () => {
  test("a different user gets their own notification", async () => {
    await notifications.notify(DB, base({ dedupeKey: "MENTION:note-1:u-1" }));
    await notifications.notify(DB, base({ userId: "u-2", dedupeKey: "MENTION:note-1:u-2" }));
    expect(mockInsertForUser).toHaveBeenCalledTimes(2);
  });

  test("a different source_ref is a different event", async () => {
    await notifications.notify(DB, base({ dedupeKey: "MENTION:note-1:u-1" }));
    await notifications.notify(DB, base({ dedupeKey: "MENTION:note-2:u-1" }));
    expect(mockInsertForUser).toHaveBeenCalledTimes(2);
  });

  test("all three key components matter — drop one and two events collide", () => {
    const k = (c, s, u) => `${c}:${s}:${u}`;
    expect(notifications.shouldDedupe(k("MENTION", "note-1", "u-1"))).toBe(false);
    expect(notifications.shouldDedupe(k("MENTION", "note-1", "u-1"))).toBe(true);
    expect(notifications.shouldDedupe(k("SLA_BREACH", "note-1", "u-1"))).toBe(false);
    expect(notifications.shouldDedupe(k("MENTION", "note-2", "u-1"))).toBe(false);
    expect(notifications.shouldDedupe(k("MENTION", "note-1", "u-2"))).toBe(false);
  });

  test("no key at all means no suppression — dedup is opt-in per event", async () => {
    await notifications.notify(DB, base());
    await notifications.notify(DB, base());
    expect(mockInsertForUser).toHaveBeenCalledTimes(2);
  });
});

describe("the window is time-bounded, not permanent", () => {
  test("the same key delivers again once the window has passed", () => {
    expect(notifications.shouldDedupe("K")).toBe(false);
    expect(notifications.shouldDedupe("K")).toBe(true);
    // Wind the recorded time back past the window rather than sleeping 60s.
    notifications.recentDedupe.set("K", Date.now() - notifications.DEDUPE_MS - 1);
    expect(notifications.shouldDedupe("K")).toBe(false);
  });

  test("the window is 60 seconds, as specified", () => {
    expect(notifications.DEDUPE_MS).toBe(60_000);
  });

  test("the map is bounded, so a long-running worker cannot leak it", () => {
    for (let i = 0; i < 6000; i += 1) notifications.shouldDedupe(`k-${i}`);
    expect(notifications.recentDedupe.size).toBeLessThanOrEqual(5000);
  });
});

describe("the rule lives in the service (§7.4 MUST)", () => {
  test("callers pass a key; none of them implements the window itself", () => {
    const fs = require("fs");
    const path = require("path");
    const callers = [
      "../../src/modules/mail/binding/mention.service.js",
      "../../src/modules/mail/triage/sla.service.js",
      "../../src/modules/mail/triage/followup.service.js",
    ];
    for (const rel of callers) {
      const src = fs.readFileSync(path.resolve(__dirname, rel), "utf8");
      expect(src).toMatch(/dedupeKey:/);
      // A second implementation of the window is a second answer to "have we
      // already told them", and the two will disagree.
      expect(src).not.toMatch(/DEDUPE_MS|recentDedupe|shouldDedupe/);
    }
  });
});
