"use strict";
/**
 * The query window (PR2) — the validator that was capped at 92 days.
 *
 * The cap was not a rounding choice, it was a REFUSAL: My HR and the HR history
 * tab both offer a year, and under 92 days the screen offered a button the API
 * answered with a 422. These pin the new ceiling, the refine that survived it,
 * and the compare-set bound that now carries the cost argument the day cap used
 * to carry alone.
 */

const validator = require("../../src/modules/hr/attendance/attendance.validator");

const { dayWindow, analyticsWindow, exportWindow, punchWindow } = validator.schemas;
const U = "11111111-1111-1111-1111-111111111111";
const V = "22222222-2222-2222-2222-222222222222";
const ok = (schema, q) => schema.safeParse(q).success;

describe("the day window", () => {
  it("accepts a full calendar year", () => {
    expect(ok(dayWindow, { from: "2026-01-01", to: "2026-12-31" })).toBe(true);
  });

  it("accepts a full LEAP year — 366 days, not 365", () => {
    // 2028-01-01 → 2028-12-31 is 366 inclusive days. A 365 cap would reject one
    // calendar year in four, which is the kind of bug that surfaces once.
    expect(ok(dayWindow, { from: "2028-01-01", to: "2028-12-31" })).toBe(true);
  });

  it("still refuses more than a year", () => {
    expect(ok(dayWindow, { from: "2026-01-01", to: "2027-01-03" })).toBe(false);
  });

  it("KEEPS the refine that the end may not precede the start", () => {
    const out = dayWindow.safeParse({ from: "2026-08-31", to: "2026-08-01" });
    expect(out.success).toBe(false);
    expect(out.error.flatten().fieldErrors.to).toBeDefined();
  });

  it("still requires both ends — an open-ended default is how a roster-sized query happens by accident", () => {
    expect(ok(dayWindow, { from: "2026-08-01" })).toBe(false);
    expect(ok(dayWindow, {})).toBe(false);
  });

  it("refuses a date that is not a date", () => {
    expect(ok(dayWindow, { from: "01/08/2026", to: "2026-08-31" })).toBe(false);
  });

  it("declares the ceiling it enforces", () => {
    expect(validator.MAX_WINDOW_DAYS).toBe(366);
  });
});

describe("the compare set", () => {
  const win = { from: "2026-08-01", to: "2026-08-31" };

  it("takes a repeated query parameter as an array", () => {
    expect(analyticsWindow.parse({ ...win, employee_ids: [U, V] }).employee_ids).toEqual([U, V]);
  });

  it("takes a single value as a one-element array", () => {
    expect(analyticsWindow.parse({ ...win, employee_ids: U }).employee_ids).toEqual([U]);
  });

  it("takes a comma-separated list, because people paste them into URLs", () => {
    expect(analyticsWindow.parse({ ...win, employee_ids: `${U}, ${V}` }).employee_ids).toEqual([U, V]);
  });

  it("refuses a non-uuid rather than letting the driver 500 on the uuid[] bind", () => {
    expect(ok(analyticsWindow, { ...win, employee_ids: "everyone" })).toBe(false);
  });

  it("caps at 50 — it is a compare set, not a bulk selector", () => {
    expect(ok(analyticsWindow, { ...win, employee_ids: Array.from({ length: 50 }, () => U) })).toBe(true);
    expect(ok(analyticsWindow, { ...win, employee_ids: Array.from({ length: 51 }, () => U) })).toBe(false);
    expect(validator.MAX_EMPLOYEE_IDS).toBe(50);
  });

  it("is optional — no selector means the caller's whole permitted set", () => {
    expect(analyticsWindow.parse(win).employee_ids).toBeUndefined();
  });

  it("takes a department", () => {
    expect(analyticsWindow.parse({ ...win, department: " Operations " }).department).toBe("Operations");
  });
});

describe("the export query", () => {
  const win = { from: "2026-08-01", to: "2026-08-31" };

  it("accepts csv and xlsx and nothing else", () => {
    expect(ok(exportWindow, { ...win, format: "csv" })).toBe(true);
    expect(ok(exportWindow, { ...win, format: "xlsx" })).toBe(true);
    expect(ok(exportWindow, { ...win, format: "pdf" })).toBe(false);
  });

  it("accepts a sheet selector for csv", () => {
    expect(ok(exportWindow, { ...win, format: "csv", sheet: "punches" })).toBe(true);
    expect(ok(exportWindow, { ...win, sheet: "everything" })).toBe(false);
  });

  it("defaults are left to the handler rather than baked in here", () => {
    const out = exportWindow.parse(win);
    expect(out.format).toBeUndefined();
    expect(out.sheet).toBeUndefined();
  });
});

describe("the self window", () => {
  it("has NO selector on it at all — there is nothing to point at another employee", () => {
    const out = punchWindow.parse({
      from: "2026-08-01", to: "2026-08-31",
      employee_id: V, employee_ids: [V], department: "Finance",
    });
    expect(out).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("is still bounded like every other window", () => {
    expect(ok(punchWindow, { from: "2026-01-01", to: "2027-06-01" })).toBe(false);
  });
});
