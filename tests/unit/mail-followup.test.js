"use strict";
const { cancelOnReply, due } = require("../../src/modules/mail/triage/followup");

describe("no-reply boomerang", () => {
  test("a client reply cancels pending NO_REPLY follow-ups on that thread", () => {
    const rows = [
      { email_followup_id: "1", email_thread_id: "t1", kind: "NO_REPLY", status: "PENDING", cancel_on_reply: true, due_at: new Date(Date.now() + 86400000) },
      { email_followup_id: "2", email_thread_id: "t2", kind: "NO_REPLY", status: "PENDING", cancel_on_reply: true, due_at: new Date(Date.now() + 86400000) },
    ];
    const out = cancelOnReply(rows, "t1");
    expect(out[0].status).toBe("CANCELLED");
    expect(out[1].status).toBe("PENDING");
  });

  test("due rows are those pending and past due_at", () => {
    const rows = [
      { status: "PENDING", due_at: new Date(Date.now() - 1000) },
      { status: "PENDING", due_at: new Date(Date.now() + 10000) },
      { status: "CANCELLED", due_at: new Date(Date.now() - 1000) },
    ];
    expect(due(rows)).toHaveLength(1);
  });
});
