/**
 * The published-month helper — audit (comment 3 on PR #264) flagged
 * `String(published_at).slice(0, 7)` on the success_story list. A pg
 * `timestamptz` returns a JS Date; `String(date)` is "Wed Aug 27 2026 …"
 * and the first 7 chars are "Wed Aug ", not "2026-08". This is the
 * single source of truth used by both surfaces.
 */
"use strict";

const { publishedMonth } = require("../../src/shared/date/published-month");

describe("publishedMonth", () => {
  test("formats a JS Date as YYYY-MM (ISO 8601)", () => {
    expect(publishedMonth(new Date("2026-08-27T12:34:56.000Z"))).toBe("2026-08");
  });

  test("formats an ISO-shaped string by slicing the first 7 chars", () => {
    expect(publishedMonth("2026-08-27T12:34:56.000Z")).toBe("2026-08");
    expect(publishedMonth("2026-08-27")).toBe("2026-08");
  });

  test("returns null for a free-form string (NOT a silent garbage slice)", () => {
    // The audit's concern: a stray String(date) would yield "Wed Aug ".
    // The helper rejects any string that is not ISO-shaped rather than
    // emitting a wrong month on the public surface.
    expect(publishedMonth("Wed Aug 27 2026 12:34:56 GMT+0000")).toBeNull();
  });

  test("returns null for null / undefined / empty string", () => {
    expect(publishedMonth(null)).toBeNull();
    expect(publishedMonth(undefined)).toBeNull();
    expect(publishedMonth("")).toBeNull();
  });
});
