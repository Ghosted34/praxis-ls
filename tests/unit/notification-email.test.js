"use strict";
// Email fan-out in the canonical notify() producer (doc/PLAN §4). Repo + email
// transport are mocked so we prove: security emails unconditionally, non-security
// email is opt-in (default OFF), in-app is unaffected by email outcome, and a
// send failure is swallowed (best-effort).

jest.mock("../../src/modules/notification/notification.repo");
jest.mock("../../src/services/email.service", () => ({ send: jest.fn().mockResolvedValue({}) }));

const repo = require("../../src/modules/notification/notification.repo");
const email = require("../../src/services/email.service");
const svc = require("../../src/modules/notification/notification.service");

const client = { query: jest.fn().mockResolvedValue({ rows: [{ email: "user@acme.com", full_name: "Ada" }] }) };

beforeEach(() => {
  repo.insertForUser.mockReset().mockResolvedValue({ notification_id: "n-1" });
  repo.isChannelEnabled.mockReset();
  email.send.mockReset().mockResolvedValue({});
  client.query.mockClear();
});

test("security notification emails unconditionally (no EMAIL pref check)", async () => {
  await svc.notify(client, { userId: "u", eventTypeKey: "auth.password_reset_completed", title: "Password changed", body: "x" });
  expect(email.send).toHaveBeenCalledTimes(1);
  expect(email.send.mock.calls[0][1]).toMatchObject({ to: "user@acme.com", purpose: "NOTIFICATIONS" });
  // EMAIL preference must NOT be consulted for security.
  const emailChecks = repo.isChannelEnabled.mock.calls.filter((c) => c[2] === "EMAIL");
  expect(emailChecks).toHaveLength(0);
});

test("non-security email is opt-in: default OFF suppresses the send", async () => {
  repo.isChannelEnabled.mockImplementation(async (_c, _u, ch) => ch === "IN_APP"); // in-app on, email off
  await svc.notify(client, { userId: "u", eventTypeKey: "invoice.posted", title: "Invoice" });
  expect(email.send).not.toHaveBeenCalled();
  expect(repo.isChannelEnabled).toHaveBeenCalledWith(client, "u", "EMAIL", "finance", false);
  expect(repo.insertForUser).toHaveBeenCalledTimes(1); // in-app still delivered
});

test("non-security email sends when the category is opted in", async () => {
  repo.isChannelEnabled.mockResolvedValue(true);
  await svc.notify(client, { userId: "u", eventTypeKey: "invoice.posted", title: "Invoice" });
  expect(email.send).toHaveBeenCalledTimes(1);
});

test("email send failure is swallowed; in-app row is still returned", async () => {
  repo.isChannelEnabled.mockResolvedValue(true);
  email.send.mockRejectedValueOnce(new Error("smtp down"));
  await expect(svc.notify(client, { userId: "u", eventTypeKey: "invoice.posted", title: "Invoice" }))
    .resolves.toEqual({ notification_id: "n-1" });
});
