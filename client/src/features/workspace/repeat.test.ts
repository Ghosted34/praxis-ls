import { describe, expect, it } from "vitest";
import { buildRule, describeRule, parseRule, repeatStateFromDue } from "./repeat";

describe("repeat — build/parse round trip", () => {
  it("builds a monthly-on-the-14th rule", () => {
    const rule = buildRule({ ...repeatStateFromDue("2026-09-14T17:00:00Z"), kind: "monthly", monthDay: 14 });
    expect(rule).toBe("FREQ=MONTHLY;BYMONTHDAY=14");
  });

  it("round-trips a weekly rule", () => {
    const rule = buildRule({ ...repeatStateFromDue(null), kind: "weekly", weekday: 1, interval: 2 });
    expect(rule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO");
    const back = parseRule(rule, null);
    expect(back.kind).toBe("weekly");
    expect(back.interval).toBe(2);
    expect(back.weekday).toBe(1);
  });

  it("adds UNTIL as a compact date", () => {
    const rule = buildRule({ ...repeatStateFromDue(null), kind: "daily", until: "2027-09-14" });
    expect(rule).toBe("FREQ=DAILY;UNTIL=20270914");
  });

  it("returns null for does-not-repeat", () => {
    expect(buildRule({ ...repeatStateFromDue(null), kind: "none" })).toBeNull();
  });
});

describe("repeat — describe", () => {
  it("says what a monthly rule means", () => {
    expect(describeRule("FREQ=MONTHLY;BYMONTHDAY=14")).toBe("Repeats every month on the 14");
  });

  it("falls back to a neutral sentence for an unknown rule", () => {
    expect(describeRule("FREQ=HOURLY")).toBe("Repeats");
    expect(describeRule(null)).toBeNull();
  });
});
