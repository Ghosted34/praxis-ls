/**
 * Calendar dates must not move, and must be renderable by a date input.
 *
 * WHAT BROKE. A Postgres `date` reached the client as `2021-09-20T23:00:00.000Z`
 * — the API's local midnight serialised to UTC. `<input type="date">` accepts
 * ONLY `YYYY-MM-DD`, so every edit form rendered a BLANK control for a date that
 * was saved while its form state still held the timestamp; Save then posted that
 * timestamp back and the API rejected it. `shared/db/pg-date-types` fixes the
 * source; `toDateInput` is the form-side guard, and `dateFmt` had to stop
 * shifting the plain dates the API now sends.
 *
 * THE SUITE PINS TZ=UTC (vitest.config.ts), which is exactly the zone where this
 * class of bug is invisible. These tests therefore set `process.env.TZ`
 * themselves — Node re-reads it per call since v16 — so both an offset ahead of
 * UTC (Africa/Douala, this product's home market) and one behind it are
 * exercised on a UTC runner.
 */
import { describe, it, expect, afterEach } from "vitest";
import { dateFmt, toDateInput } from "./format";

const withTz = <T>(tz: string, fn: () => T): T => {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = previous;
  }
};

afterEach(() => {
  process.env.TZ = "UTC";
});

describe("toDateInput", () => {
  it("passes a calendar date through untouched", () => {
    expect(toDateInput("2021-09-21")).toBe("2021-09-21");
  });

  it("does not move the day in a timezone behind UTC", () => {
    // The regression a naive `new Date(s)` round-trip introduces: UTC midnight
    // is the previous evening in New York, so the control would offer the 20th.
    expect(withTz("America/New_York", () => toDateInput("2021-09-21"))).toBe("2021-09-21");
  });

  it("does not move the day in a timezone ahead of UTC", () => {
    expect(withTz("Africa/Douala", () => toDateInput("2021-09-21"))).toBe("2021-09-21");
  });

  it("recovers the calendar day from a legacy timestamp response", () => {
    // What the API sent before pg-date-types: 21 Sept stored, serialised from
    // the server's local midnight. Slicing the first ten characters would rewind
    // it to the 20th; resolving the instant locally reads it back correctly.
    expect(withTz("Africa/Douala", () => toDateInput("2021-09-20T23:00:00.000Z"))).toBe("2021-09-21");
  });

  it("accepts a Date object", () => {
    expect(toDateInput(new Date(2021, 8, 21))).toBe("2021-09-21");
  });

  it("returns '' for blanks and rubbish, so a date input stays empty rather than invalid", () => {
    for (const v of [null, undefined, "", "not a date", Number.NaN, new Date("nope")]) {
      expect(toDateInput(v)).toBe("");
    }
  });

  it("pads single-digit months and days", () => {
    expect(toDateInput(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("dateFmt", () => {
  it("renders a calendar date as itself, whatever the reader's timezone", () => {
    // `new Date("2021-09-21")` is midnight UTC — the 20th in every negative
    // offset, which is what this used to print for a date column.
    expect(withTz("America/New_York", () => dateFmt("2021-09-21"))).toBe("21 Sept 2021");
    expect(withTz("Africa/Douala", () => dateFmt("2021-09-21"))).toBe("21 Sept 2021");
    expect(dateFmt("2021-09-21")).toBe("21 Sept 2021");
  });

  it("still renders a timestamp as an instant in the reader's timezone", () => {
    expect(withTz("Africa/Douala", () => dateFmt("2021-09-20T23:00:00.000Z"))).toBe("21 Sept 2021");
  });

  it("renders blanks and unparseable values as an em dash", () => {
    expect(dateFmt(null)).toBe("—");
    expect(dateFmt("")).toBe("—");
    expect(dateFmt("not a date")).toBe("—");
  });
});
