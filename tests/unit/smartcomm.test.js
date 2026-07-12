"use strict";
const service = require("../../src/modules/smartcomm/smartcomm.service");

// Fake client: findMember (SELECT * FROM comms_member) drives membership.
function makeClient({ member = null }) {
  return { query: async (sql) => {
    if (/FROM comms_member WHERE group_id/.test(sql)) return { rows: member ? [member] : [] };
    return { rows: [] };
  } };
}
const actor = { user_id: "u1" };

describe("Smart Comms authorization + guards (MOD-64)", () => {
  test("non-member cannot post", async () => {
    await expect(service.postMessage(makeClient({ member: null }), { groupId: "g1", body: "hi", actor }))
      .rejects.toThrow(/not a member/i);
  });
  test("member cannot post an empty message", async () => {
    await expect(service.postMessage(makeClient({ member: { group_id: "g1", user_id: "u1" } }), { groupId: "g1", actor }))
      .rejects.toThrow(/needs a body or media/i);
  });
  test("non-member cannot read a thread", async () => {
    await expect(service.thread(makeClient({ member: null }), { groupId: "g1", actor }))
      .rejects.toThrow(/not a member/i);
  });
  test("search rejects too-short terms", async () => {
    await expect(service.search(makeClient({ member: {} }), { actor, term: "a" })).rejects.toThrow(/too short/i);
  });
});
