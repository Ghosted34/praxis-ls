"use strict";
/**
 * Calls audit D9: the channel list read ran three correlated subqueries per
 * channel row for the DIRECT partner (id, avatar, last seen). It is one
 * lateral join now; the real-schema half is
 * tests/integration/smartcomm-channel-partner.test.js.
 */
const repo = require("../../src/modules/smartcomm/smartcomm.repo");

test("the DIRECT partner comes from one lateral join", async () => {
  let sql = "";
  await repo.listChannelsForUser({ query: async (s) => { sql = s; return { rows: [] }; } }, "u1", {});
  expect(sql.match(/LEFT JOIN LATERAL/g)).toHaveLength(1);
  expect(sql).not.toMatch(/CASE WHEN g\.kind = 'DIRECT' THEN \(SELECT/);
  expect(sql).toMatch(/partner\.user_id AS partner_user_id/);
  expect(sql).toMatch(/partner\.last_seen_at AS partner_last_seen_at/);
});
