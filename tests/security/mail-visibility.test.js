"use strict";
const { canSee, clause } = require("../../src/modules/mail/triage/visibility");

describe("visibility predicate", () => {
  test("a Private thread is invisible to a colleague with only membership", () => {
    const r = canSee({ visibility: "PRIVATE" }, { userId: "u2", isOwner: false, isMember: true, isShared: false });
    expect(r.ok).toBe(false);
  });

  test("the owner sees Private", () => {
    expect(canSee({ visibility: "PRIVATE" }, { isOwner: true }).ok).toBe(true);
  });

  test("Team requires membership", () => {
    expect(canSee({ visibility: "TEAM" }, { isMember: false }).ok).toBe(false);
    expect(canSee({ visibility: "TEAM" }, { isMember: true }).ok).toBe(true);
  });

  test("God-Mode can see Private but flags break-glass", () => {
    const r = canSee({ visibility: "PRIVATE" }, { isGodMode: true, isOwner: false, isShared: false });
    expect(r.ok).toBe(true);
    expect(r.breakglass).toBe(true);
  });

  test("there is one SQL clause", () => {
    expect(clause("$1")).toMatch(/visibility = 'PRIVATE'/);
    expect(clause("$1")).toMatch(/email_thread_share/);
  });
});
