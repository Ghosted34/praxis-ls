/**
 * A notification says WHERE, not just WHAT.
 *
 * ── WHAT WAS BROKEN ────────────────────────────────────────────────────────
 *
 * Clicking a notification marked it read and moved the user nowhere. `notify()`
 * has accepted a `url` since it was written, but that value reached web-push
 * ONLY — it was never stored on the row, so the in-app list had nothing to
 * navigate to. Five producers in the whole backend passed one at all, and two
 * of the five passed a path the router does not serve.
 *
 * These tests pin the three decisions that make the fix work, each of which is
 * easy to "simplify" back into the bug:
 *
 *   1. The row is stamped with `link_url`, derived from `entity_ref` when the
 *      producer did not say. Without the derivation the column is empty for
 *      almost every notification in the product.
 *   2. `link_url` is NULL when there is nowhere to go, while the PUSH still
 *      gets `/notifications`. Collapsing those two into one value is how the
 *      dead click comes back: a row that links to the list it was clicked from.
 *   3. An explicit `url` beats the map, because mail's `?thread=` query is not
 *      derivable from a type and an id.
 */
"use strict";

const mockInsertForUser = jest.fn(async () => ({ notification_id: "n-1" }));
const mockInsertForUsers = jest.fn(async () => [{ notification_id: "n-1", user_id: "u-1" }]);
const mockPushSend = jest.fn(async () => ({ sent: 1 }));

jest.mock("../../src/modules/notification/notification.repo", () => ({
  insertForUser: (...a) => mockInsertForUser(...a),
  insertForUsers: (...a) => mockInsertForUsers(...a),
  isChannelEnabled: jest.fn(async () => true),
  preferencesFor: jest.fn(async () => new Map()),
  activeEmailsFor: jest.fn(async () => new Map()),
  listPushSubscriptions: jest.fn(async () => []),
  unreadCount: jest.fn(async () => 0),
  unreadCountsFor: jest.fn(async () => new Map()),
}));
jest.mock("../../src/shared/push/push.service", () => ({
  sendToUser: (...a) => mockPushSend(...a),
  getPublicKey: jest.fn(async () => "vapid-pub"),
}));
jest.mock("../../src/services/email.service", () => ({ send: jest.fn(async () => ({})) }));

const notifications = require("../../src/modules/notification/notification.service");

const DB = { query: jest.fn(async () => ({ rows: [] })) };
const insertedLink = () => mockInsertForUser.mock.calls.at(-1)[1].linkUrl;
const pushedUrl = () => mockPushSend.mock.calls.at(-1)[1].url;

beforeEach(() => jest.clearAllMocks());

describe("the row carries where to go", () => {
  it("derives link_url from entity_ref when the producer did not say", async () => {
    await notifications.notify(DB, {
      userId: "u-1", title: "New lead", entityRef: "lead:42", category: "sales",
    });
    expect(insertedLink()).toBe("/sales/leads/42");
  });

  it("lands on the list when the type has no detail route", async () => {
    // "Payroll posted" opening Payroll is one click from the run. The dead
    // click was an unbounded hunt, so a list beats nothing — and the UI says
    // "Opens the list" rather than implying it shows the exact record.
    await notifications.notify(DB, {
      userId: "u-1", title: "Payroll posted", entityRef: "payroll:7", category: "finance",
    });
    expect(insertedLink()).toBe("/hr/payroll");
  });

  it("lets an explicit url beat the map", async () => {
    await notifications.notify(DB, {
      userId: "u-1", title: "You were mentioned",
      entityRef: "email_thread:t-1", url: "/comms/mail?thread=t-1", category: "MENTION",
    });
    expect(insertedLink()).toBe("/comms/mail?thread=t-1");
  });

  it("stamps the batch fan-out too", async () => {
    // notifyMany is the path the whole event engine uses — the fan-out being
    // unstamped would leave nearly every notification in the product dead.
    await notifications.notifyMany(DB, ["u-1", "u-2"], {
      title: "Invoice posted", entityRef: "invoice:9", category: "finance",
    });
    expect(mockInsertForUsers.mock.calls.at(-1)[2].linkUrl).toBe("/finance/invoices");
  });
});

describe("nowhere to go is a real answer", () => {
  it("stores NULL rather than pointing back at the inbox", async () => {
    // A God Mode PIN is the entire message. `/notifications` here would be the
    // dead click one indirection along: click a notification, arrive at the
    // list of notifications.
    await notifications.notify(DB, {
      userId: "u-1", title: "Your new God Mode PIN", category: "security",
    });
    expect(insertedLink()).toBeNull();
  });

  it("still gives the PUSH somewhere to open", async () => {
    // Tapping a phone banner must open the app; with nothing better the inbox
    // IS the right landing. This is the one place the two answers differ.
    await notifications.notify(DB, {
      userId: "u-1", title: "Your new God Mode PIN", category: "security",
    });
    expect(pushedUrl()).toBe("/notifications");
  });

  it("stores NULL for a ref that maps nowhere", async () => {
    await notifications.notify(DB, {
      userId: "u-1", title: "DNS check failed", entityRef: "domain:praxisls.com", category: "system",
    });
    expect(insertedLink()).toBeNull();
  });
});

describe("the push and the in-app row agree", () => {
  it("sends the phone the same place the bell goes", async () => {
    // They used to be computed at different times by different code. A user who
    // taps the banner and a user who opens the bell are looking at one event.
    await notifications.notify(DB, {
      userId: "u-1", title: "New lead", entityRef: "lead:42", category: "sales",
    });
    expect(pushedUrl()).toBe("/sales/leads/42");
    expect(insertedLink()).toBe("/sales/leads/42");
  });
});
