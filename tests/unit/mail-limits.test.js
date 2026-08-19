/**
 * Send-rate arithmetic and mailbox health (PR-0).
 *
 * The throttle exists because shared cPanel hosting SUSPENDS a mailbox that
 * exceeds its hourly cap. Getting the arithmetic wrong in the permissive
 * direction takes the company's email down, so the boundaries are tested
 * exactly rather than approximately.
 */
"use strict";

const limits = require("../../src/modules/mail/mail/limits");

const L = { send_limit_hourly: 10, send_limit_daily: 50 };

describe("decide", () => {
  test("allows up to the limit and reports what is left", () => {
    const d = limits.decide({ hourlyUsed: 9, dailyUsed: 9, limits: L });
    expect(d.allowed).toBe(true);
    expect(d.remaining_hour).toBe(0);
    expect(d.remaining_day).toBe(40);
  });

  test("the boundary is inclusive: the tenth message goes, the eleventh waits", () => {
    expect(limits.decide({ hourlyUsed: 9, limits: L }).allowed).toBe(true);
    expect(limits.decide({ hourlyUsed: 10, limits: L }).allowed).toBe(false);
  });

  test("a bulk run is judged as a whole, not discovered halfway through", () => {
    const d = limits.decide({ hourlyUsed: 5, limits: L, count: 6 });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("HOURLY_LIMIT");
  });

  test("the hourly cap sends you to the next hour", () => {
    const at = new Date("2026-08-19T14:37:00Z");
    const d = limits.decide({ hourlyUsed: 10, limits: L, at });
    expect(d.reason).toBe("HOURLY_LIMIT");
    expect(d.retryAt.toISOString()).toBe("2026-08-19T15:00:00.000Z");
  });

  test("the daily cap sends you to midnight, not the next hour", () => {
    // Promising the next hour when the daily counter is full would have the UI
    // guarantee a delivery that will not happen.
    const at = new Date("2026-08-19T14:37:00Z");
    const d = limits.decide({ hourlyUsed: 0, dailyUsed: 50, limits: L, at });
    expect(d.reason).toBe("DAILY_LIMIT");
    expect(d.retryAt.toISOString()).toBe("2026-08-20T00:00:00.000Z");
  });

  test("the daily cap is checked before the hourly one", () => {
    const d = limits.decide({ hourlyUsed: 10, dailyUsed: 50, limits: L });
    expect(d.reason).toBe("DAILY_LIMIT");
  });
});

describe("effectiveLimits", () => {
  test("a connection override wins over the tenant default", () => {
    expect(
      limits.effectiveLimits(
        { send_limit_hourly: 20 },
        { send_limit_hourly: 400 },
      ).send_limit_hourly,
    ).toBe(20);
  });

  test("NULL on the row inherits the tenant default — that is the whole point", () => {
    expect(
      limits.effectiveLimits(
        { send_limit_hourly: null },
        { send_limit_hourly: 400 },
      ).send_limit_hourly,
    ).toBe(400);
  });

  test("neither set falls through to the built-in", () => {
    expect(limits.effectiveLimits({}, {}).send_limit_hourly).toBe(
      limits.DEFAULTS.send_limit_hourly,
    );
  });

  test("zero sync depth is honoured, not treated as absent", () => {
    // 0 means "no historical import at all", which is a real choice.
    expect(
      limits.effectiveLimits({ sync_depth_days: 0 }, { sync_depth_days: 90 })
        .sync_depth_days,
    ).toBe(0);
  });
});

describe("windowStart", () => {
  test("truncates to the hour", () => {
    expect(
      limits.windowStart(new Date("2026-08-19T14:37:12.345Z")).toISOString(),
    ).toBe("2026-08-19T14:00:00.000Z");
  });
});

describe("health", () => {
  const now = new Date("2026-08-19T12:00:00Z");

  test("a healthy mailbox says so plainly", () => {
    const h = limits.health(
      {
        status: "CONNECTED",
        consecutive_failures: 0,
        last_success_at: new Date("2026-08-19T11:55:00Z"),
      },
      { now },
    );
    expect(h.level).toBe("OK");
  });

  test("one failure warns rather than alarms", () => {
    expect(
      limits.health({ status: "CONNECTED", consecutive_failures: 1 }, { now })
        .level,
    ).toBe("WARN");
  });

  test("three in a row is DOWN, and says why", () => {
    const h = limits.health(
      {
        status: "CONNECTED",
        consecutive_failures: 3,
        last_error: "auth failed",
      },
      { now },
    );
    expect(h.level).toBe("DOWN");
    expect(h.reason).toContain("auth failed");
  });

  test("a long silence warns even with no recorded failure", () => {
    const h = limits.health(
      {
        status: "CONNECTED",
        consecutive_failures: 0,
        last_success_at: new Date("2026-08-19T02:00:00Z"),
      },
      { now },
    );
    expect(h.level).toBe("WARN");
    expect(h.stale_hours).toBe(10);
  });

  test("archived, disabled and pending are their own states, not failures", () => {
    expect(limits.health({ status: "ARCHIVED" }, { now }).level).toBe(
      "ARCHIVED",
    );
    expect(limits.health({ status: "DISABLED" }, { now }).level).toBe("OFF");
    expect(limits.health({ status: "PENDING" }, { now }).level).toBe("PENDING");
  });

  test("connected but never synced is PENDING, not OK", () => {
    expect(
      limits.health({ status: "CONNECTED", consecutive_failures: 0 }, { now })
        .level,
    ).toBe("PENDING");
  });
});
