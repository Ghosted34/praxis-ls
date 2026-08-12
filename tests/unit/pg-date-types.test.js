/**
 * `date` columns must reach JSON as `YYYY-MM-DD`.
 *
 * THE BUG. node-postgres parses OID 1082 into a JS `Date` at midnight in the
 * PROCESS timezone, and `res.json()` serialises that with `toISOString()`. On a
 * server running Africa/Douala (UTC+1 — this product's home market) a
 * registration issued on 2021-09-21 left the API as `2021-09-20T23:00:00.000Z`:
 * the wrong day, in a format `<input type="date">` cannot render. Every edit
 * form opened with a blank date for a date that was saved, and saving it back
 * failed the shared `isoDate` schema — `Use the format YYYY-MM-DD., That date
 * doesn't exist.` — on a row nobody had touched.
 *
 * The UTC+1 case is what these tests pin, because it is the one that reproduces
 * in production and the one a UTC-only CI runner would never see.
 */
"use strict";

const { types } = require("pg");

const DATE_OID = 1082;
const TIMESTAMP_OID = 1114;
const TIMESTAMPTZ_OID = 1184;

describe("pg date type parsers", () => {
  const originalTz = process.env.TZ;

  beforeAll(() => {
    require("../../src/shared/db/pg-date-types");
  });

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("hands a date column back as the YYYY-MM-DD string Postgres sent", () => {
    expect(types.getTypeParser(DATE_OID)("2021-09-21")).toBe("2021-09-21");
  });

  it("keeps the calendar day in a timezone ahead of UTC", () => {
    // The reproduction. Under the default parser this value became a Date at
    // 2021-09-21T00:00+01:00, whose toISOString() is the 20th.
    process.env.TZ = "Africa/Douala";
    const parsed = types.getTypeParser(DATE_OID)("2021-09-21");
    expect(JSON.parse(JSON.stringify({ issued_on: parsed }))).toEqual({
      issued_on: "2021-09-21",
    });
  });

  it("keeps the calendar day in a timezone behind UTC", () => {
    process.env.TZ = "America/New_York";
    expect(types.getTypeParser(DATE_OID)("2021-09-21")).toBe("2021-09-21");
  });

  it("survives JSON round-tripping in the shape a date input needs", () => {
    const row = {
      issued_on: types.getTypeParser(DATE_OID)("2021-09-21"),
      expires_on: types.getTypeParser(DATE_OID)("2026-08-14"),
    };
    const wire = JSON.parse(JSON.stringify(row));
    expect(wire.issued_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(wire.expires_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("leaves timestamp and timestamptz alone — an instant is not a calendar date", () => {
    expect(
      types.getTypeParser(TIMESTAMP_OID)("2021-09-21 08:30:00"),
    ).toBeInstanceOf(Date);
    expect(
      types.getTypeParser(TIMESTAMPTZ_OID)("2021-09-21 08:30:00+01"),
    ).toBeInstanceOf(Date);
  });

  it("is idempotent — every pool module requires it", () => {
    const {
      applyDateTypeParsers,
    } = require("../../src/shared/db/pg-date-types");
    applyDateTypeParsers();
    applyDateTypeParsers();
    expect(types.getTypeParser(DATE_OID)("2021-09-21")).toBe("2021-09-21");
  });

  it("passes infinity through instead of producing an Invalid Date", () => {
    expect(types.getTypeParser(DATE_OID)("infinity")).toBe("infinity");
    expect(types.getTypeParser(DATE_OID)("-infinity")).toBe("-infinity");
  });
});
