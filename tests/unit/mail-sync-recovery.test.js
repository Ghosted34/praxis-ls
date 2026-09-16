"use strict";
const repo = require("../../src/modules/mail/mail/mail.repo");
const mailbox = require("../../src/modules/mail/mail/mailbox.repo");
const db = { query: jest.fn(async () => ({ rows: [] })) };
beforeEach(() => jest.clearAllMocks());

test("polling retries ERROR mailboxes, without selecting retired or disabled ones", async () => {
  await repo.listSyncable(db);
  expect(db.query.mock.calls[0][0]).toContain("status IN ('CONNECTED', 'ERROR')");
});

test("successful sync restores status and updates the displayed last-sync time", async () => {
  await mailbox.clearFailures(db, "c1");
  const [sql, params] = db.query.mock.calls[0];
  expect(sql).toContain("status = 'CONNECTED'");
  expect(sql).toContain("last_sync_at = now()");
  expect(sql).toContain("status IN ('CONNECTED', 'ERROR')");
  expect(params).toEqual(["c1"]);
});

test("a late sync failure cannot unarchive a disconnected mailbox", async () => {
  await repo.setError(db, "c1", "network error");
  expect(db.query.mock.calls[0][0]).toContain("status NOT IN ('ARCHIVED', 'DISABLED')");
});
