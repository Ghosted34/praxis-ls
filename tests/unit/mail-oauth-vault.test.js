"use strict";

jest.mock("../../src/modules/security/setting/setting.repo", () => ({
  getByKey: jest.fn(async () => null),
  upsert: jest.fn(async (_c, row) => row),
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => {}), audit: jest.fn(async () => {}),
}));
const settings = require("../../src/modules/security/setting/setting.service");
const repo = require("../../src/modules/security/setting/setting.repo");
const encryption = require("../../src/services/encryption.service");

beforeEach(() => jest.clearAllMocks());

test.each(["microsoft_graph", "google_gmail"])("stores a large %s token bundle encrypted and redacted", async (provider) => {
  const secret = JSON.stringify({ access_token: "a".repeat(5000), refresh_token: "r".repeat(2000), expires_at: Date.now() + 3600000 });
  const result = await settings.put({}, {
    section: settings.SECRET_SECTION, key: "mail_conn:1",
    value: { provider, key_name: "MAIL_CONN", secret },
  });
  const stored = repo.upsert.mock.calls[0][1].value;
  expect(encryption.decrypt(stored.secret_enc)).toBe(secret);
  expect(stored.secret).toBeUndefined();
  expect(result.value.secret_enc).toBeUndefined();
  expect(result.value.secret).toBeUndefined();
});

test.each([
  ["microsoft_graph", "MAIL_CONN", 65537],
  ["imap_smtp", "MAIL_CONN", 4001],
  ["microsoft_graph", "OTHER", 4001],
  ["microsoft_graph", "MAIL_CONN", 0],
])("keeps bounded validation for %s/%s (%i chars)", async (provider, key_name, length) => {
  await expect(settings.put({}, {
    section: settings.SECRET_SECTION, key: "mail_conn:1",
    value: { provider, key_name, secret: "x".repeat(length) },
  })).rejects.toMatchObject({ code: "BAD_SECRET" });
  expect(repo.upsert).not.toHaveBeenCalled();
});
