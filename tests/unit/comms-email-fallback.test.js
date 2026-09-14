"use strict";

/**
 * A Smart Comms message reaches a colleague with no registered device.
 *
 * ── WHAT WAS MISSING ───────────────────────────────────────────────────────
 *
 * Mail has made the reliability promise since it was written — `emailFallback:
 * true`, "a notification that reaches no device must reach the person some
 * other way". Chat, the channel people use when they want an answer NOW, was
 * the one conversational surface without it. A message to someone with no push
 * subscription produced an in-app row and nothing else, which they would see
 * whenever they next happened to open the app.
 *
 * The carve-outs that keep this from being a flood — silenced category, no
 * VAPID keypair deployment-wide — are `deliverOutbound`'s and are pinned in
 * notification-delivery-reliability.test.js. What THIS file pins is the half
 * that lives at the call site and that a refactor can silently drop: that
 * `postMessage` asks for the fallback at all.
 *
 * It drives the real `postMessage` rather than re-calling `notifyMany` by hand
 * — the existing G22 test asserts a call it makes itself, which cannot catch a
 * producer that stops passing the option.
 */

jest.mock("../../src/modules/smartcomm/smartcomm.repo", () => ({
  findMember: jest.fn(async () => ({ user_id: "u-1", group_id: "g-1" })),
  insertMessage: jest.fn(async () => ({ message_id: "m-1", group_id: "g-1" })),
  addAttachment: jest.fn(async () => ({})),
  updateChannel: jest.fn(async () => ({})),
  memberUserIds: jest.fn(async () => ["u-2", "u-3"]),
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => ({})),
  audit: jest.fn(async () => ({})),
  resolveActorId: jest.fn(async () => "u-1"),
}));
jest.mock("../../src/realtime", () => ({ publish: jest.fn() }));
jest.mock("../../src/modules/notification/notification.service", () => ({
  notifyMany: jest.fn(async () => 2),
}));

const service = require("../../src/modules/smartcomm/smartcomm.service");
const notify = require("../../src/modules/notification/notification.service");

const client = { query: jest.fn(async () => ({ rows: [] })) };
const post = () =>
  service.postMessage(client, {
    groupId: "g-1",
    body: "Confirm reception of the BL",
    actor: { user_id: "u-1", display_name: "Timothee Massomba" },
  });

beforeEach(() => jest.clearAllMocks());

describe("a chat message asks for the email fallback", () => {
  it("passes emailFallback so a deviceless member is still reached", async () => {
    await post();
    expect(notify.notifyMany).toHaveBeenCalledWith(
      client,
      ["u-2", "u-3"],
      expect.objectContaining({ emailFallback: true }),
    );
  });

  it("keeps the per-channel push collapse alongside it", async () => {
    // `pushTag` bounds the BANNERS from a fast exchange; it does nothing for
    // the email leg. Pinned together so the relationship between the two — and
    // the gap between them, documented in doc/PUSH_NOTIFICATIONS.md — stays
    // visible to whoever changes either.
    await post();
    expect(notify.notifyMany).toHaveBeenCalledWith(
      client,
      expect.any(Array),
      expect.objectContaining({
        pushTag: "comms:g-1",
        renotify: true,
        urgency: "high",
        category: "comms",
      }),
    );
  });

  it("still excludes the sender", async () => {
    // The fallback makes being notified louder, so "do not email me about my
    // own message" matters more than it did, not less.
    const repo = require("../../src/modules/smartcomm/smartcomm.repo");
    await post();
    expect(repo.memberUserIds).toHaveBeenCalledWith(client, "g-1", "u-1");
  });

  it("does not notify at all when the caller opts out", async () => {
    await service.postMessage(client, {
      groupId: "g-1",
      body: "system card",
      actor: { user_id: "u-1" },
      notifyMembers: false,
    });
    expect(notify.notifyMany).not.toHaveBeenCalled();
  });
});
