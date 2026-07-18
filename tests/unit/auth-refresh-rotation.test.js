"use strict";
// Rotation reuse-detection (session 8). The refresh() flow is dependency-heavy
// (jwt/redis/repo), so the security-critical decision is a small pure predicate
// exported for exactly this test: is the presented refresh token the session's
// current one, or a rotated-away/replayed token?
const svc = require("../../src/modules/security/app_user/app_user.service");

describe("refresh-token rotation — reuse detection", () => {
  const jti = "11111111-1111-1111-1111-111111111111";
  const other = "22222222-2222-2222-2222-222222222222";

  test("current token (jti matches the session) is NOT reuse", () => {
    expect(svc.refreshTokenReused({ refresh_jti: jti }, { jti })).toBe(false);
  });

  test("rotated-away token (jti mismatch) IS reuse", () => {
    expect(svc.refreshTokenReused({ refresh_jti: jti }, { jti: other })).toBe(true);
  });

  test("legacy session (null / absent refresh_jti) is grandfathered — not reuse", () => {
    expect(svc.refreshTokenReused({ refresh_jti: null }, { jti })).toBe(false);
    expect(svc.refreshTokenReused({}, { jti })).toBe(false);
  });

  test("a token with no jti is not treated as reuse (defensive)", () => {
    expect(svc.refreshTokenReused({ refresh_jti: jti }, {})).toBe(false);
    expect(svc.refreshTokenReused({ refresh_jti: jti }, null)).toBe(false);
  });

  test("missing session is not reuse", () => {
    expect(svc.refreshTokenReused(null, { jti })).toBe(false);
  });
});
