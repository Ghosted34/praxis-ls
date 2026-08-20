"use strict";
const { append, verify } = require("../../src/modules/mail/triage/archive-chain");

describe("archive chain", () => {
  test("tampering with a body breaks verification", () => {
    const a = append(null, { body: "hello", headers: { from: "a" } });
    const b = append({ chain_hash: a.chain_hash }, { body: "world", headers: { from: "a" } });
    const rows = [
      { seq: 1, ...a },
      { seq: 2, ...b },
    ];
    expect(verify(rows).ok).toBe(true);
    rows[0].content_hash = "deadbeef";
    const broken = verify(rows);
    expect(broken.ok).toBe(false);
    expect(broken.broken_at).toBe(0);
  });
});
