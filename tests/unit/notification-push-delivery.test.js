"use strict";
// Web-push delivery gating in notify() (doc/PLAN §4). Push is device-level opt-in
// and mirrors the in-app decision: it fires for security and for delivered
// non-security notifications, but NOT when in-app was suppressed by preference.

jest.mock("../../src/modules/notification/notification.repo");
jest.mock("../../src/services/email.service", () => ({
  send: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../src/shared/push/push.service", () => ({
  sendToUser: jest.fn().mockResolvedValue({ sent: 1 }),
  getPublicKey: jest.fn(),
}));

const repo = require("../../src/modules/notification/notification.repo");
const push = require("../../src/shared/push/push.service");
const svc = require("../../src/modules/notification/notification.service");

const client = {
  query: jest
    .fn()
    .mockResolvedValue({ rows: [{ email: "u@x.com", full_name: "U" }] }),
};

beforeEach(() => {
  repo.insertForUser.mockReset().mockResolvedValue({ notification_id: "n" });
  repo.isChannelEnabled.mockReset();
  push.sendToUser.mockClear();
});

test("security notification pushes (unconditional), passing the tenant client", async () => {
  await svc.notify(client, {
    userId: "u",
    eventTypeKey: "auth.password_reset_completed",
    title: "Sec",
  });
  expect(push.sendToUser).toHaveBeenCalledTimes(1);
  expect(push.sendToUser).toHaveBeenCalledWith(
    client,
    expect.objectContaining({ user_id: "u", url: "/notifications" }),
  );
});

test("delivered non-security notification pushes", async () => {
  repo.isChannelEnabled.mockImplementation(
    async (_c, _u, ch) => ch === "IN_APP",
  );
  await svc.notify(client, {
    userId: "u",
    eventTypeKey: "invoice.posted",
    title: "Inv",
  });
  expect(push.sendToUser).toHaveBeenCalledTimes(1);
});

test("in-app suppressed by preference → no push", async () => {
  repo.isChannelEnabled.mockResolvedValue(false); // in-app off
  const out = await svc.notify(client, {
    userId: "u",
    eventTypeKey: "invoice.posted",
    title: "Inv",
  });
  expect(out).toBeNull();
  expect(push.sendToUser).not.toHaveBeenCalled();
});
