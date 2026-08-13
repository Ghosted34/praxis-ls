"use strict";

/**
 * SEC-C3, second half — the failed-login counter is now enforced.
 *
 * `failed_logins` has been incremented on every bad password since migration
 * 0100 and reset on success, and never READ by anything. The IP rate limiter
 * added alongside this stops one address hammering the endpoint; it cannot see
 * a distributed attempt spread across many addresses against ONE account. That
 * is what this covers.
 *
 * The property being defended is as much availability as security: the cooldown
 * must DECAY on its own and must never latch, because a lockout that needs an
 * administrator to clear is a denial-of-service lever pointed at your own
 * users. Several assertions below exist only to pin that down.
 */

const {
  throttleFor,
} = require("../../src/modules/security/app_user/app_user.service");

const NOW = new Date("2026-08-04T12:00:00Z").getTime();
const agoSeconds = (s) => new Date(NOW - s * 1000).toISOString();

describe("SEC-C3 — login cooldown curve", () => {
  it("does not throttle an ordinary mistyped password", () => {
    // Five free attempts. A human who fat-fingers their password twice must not
    // notice this control exists.
    for (let n = 0; n <= 5; n++) {
      const user = { failed_logins: n, last_failed_login_at: agoSeconds(0) };
      expect(throttleFor(user, NOW)).toBe(0);
    }
  });

  it("doubles the wait past the free attempts", () => {
    const at = (n) =>
      throttleFor(
        { failed_logins: n, last_failed_login_at: agoSeconds(0) },
        NOW,
      );
    expect(at(6)).toBe(2);
    expect(at(7)).toBe(4);
    expect(at(8)).toBe(8);
    expect(at(10)).toBe(32);
  });

  it("caps at 15 minutes so it can never become an effective lockout", () => {
    // The cap is the anti-DoS guarantee: however many times an attacker fails
    // against someone else's account, that account is usable again within the
    // quarter hour, with no administrator involved.
    const at = (n) =>
      throttleFor(
        { failed_logins: n, last_failed_login_at: agoSeconds(0) },
        NOW,
      );
    expect(at(30)).toBe(15 * 60);
    expect(at(10000)).toBe(15 * 60);
  });

  it("DECAYS — the wait shrinks as time passes", () => {
    const user = (elapsed) => ({
      failed_logins: 10,
      last_failed_login_at: agoSeconds(elapsed),
    });
    expect(throttleFor(user(0), NOW)).toBe(32);
    expect(throttleFor(user(20), NOW)).toBe(12);
    expect(throttleFor(user(32), NOW)).toBe(0);
    expect(throttleFor(user(600), NOW)).toBe(0);
  });

  it("never latches: a long-idle account with old failures is not throttled", () => {
    // The regression this guards: counting failures without timestamping them
    // means someone who mistyped ten times last year is locked out forever.
    const user = { failed_logins: 50, last_failed_login_at: agoSeconds(86400) };
    expect(throttleFor(user, NOW)).toBe(0);
  });

  it("is inert when there is no recorded failure time", () => {
    // Rows predating migration 0495 have NULL here. They must behave as
    // "no failure on record", not as "throttled forever".
    expect(
      throttleFor({ failed_logins: 99, last_failed_login_at: null }, NOW),
    ).toBe(0);
    expect(throttleFor({ failed_logins: 99 }, NOW)).toBe(0);
  });

  it("handles a missing or malformed user without throwing", () => {
    expect(throttleFor(null, NOW)).toBe(0);
    expect(throttleFor({}, NOW)).toBe(0);
    expect(throttleFor({ failed_logins: "not a number" }, NOW)).toBe(0);
  });
});
