"use strict";
const { mintToken, hashToken, isUsable } = require("../../src/modules/mail/triage/secure-link");

describe("secure link", () => {
  test("the token is not the hash — we never store the token", () => {
    const t = mintToken();
    const h = hashToken(t);
    expect(h).not.toBe(t);
    expect(h).toHaveLength(64);
    expect(t).not.toHaveLength(64);
  });

  test("expiry and revoke make the link unusable", () => {
    const row = { expires_at: new Date(Date.now() + 86400000).toISOString(), revoked_at: null };
    expect(isUsable(row)).toBe(true);
    expect(isUsable({ ...row, revoked_at: new Date().toISOString() })).toBe(false);
    expect(isUsable({ ...row, expires_at: new Date(Date.now() - 1000).toISOString() })).toBe(false);
  });
});
