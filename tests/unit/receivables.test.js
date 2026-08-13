"use strict";
const {
  ageingBuckets,
  planAllocation,
  dunningFor,
  daysOverdue,
} = require("../../src/modules/finance/smart_receivables/smart_receivables.rules");

describe("receivables ageing (MOD-52)", () => {
  const asOf = "2026-07-11";
  test("buckets by overdue age", () => {
    const r = ageingBuckets(
      [
        { outstanding: 100, due_on: "2026-08-01" }, // future -> current
        { outstanding: 200, due_on: "2026-07-01" }, // 10 days -> 1-30
        { outstanding: 300, due_on: "2026-05-20" }, // ~52 days -> 31-60
        { outstanding: 400, due_on: "2026-01-01" }, // >90 -> 90+
        { outstanding: 0, due_on: "2026-01-01" }, // ignored
      ],
      asOf,
    );
    expect(r.current).toBe(100);
    expect(r.d1_30).toBe(200);
    expect(r.d31_60).toBe(300);
    expect(r.d90_plus).toBe(400);
    expect(r.total).toBe(1000);
  });
});

describe("receivables allocation FIFO", () => {
  test("applies oldest-first and reports unapplied", () => {
    const r = planAllocation(250, [
      { invoice_id: "a", outstanding: 100 },
      { invoice_id: "b", outstanding: 100 },
      { invoice_id: "c", outstanding: 100 },
    ]);
    expect(r.allocations).toEqual([
      { invoice_id: "a", amount: 100 },
      { invoice_id: "b", amount: 100 },
      { invoice_id: "c", amount: 50 },
    ]);
    expect(r.applied_total).toBe(250);
    expect(r.unapplied).toBe(0);
  });
  test("overpayment leaves remainder unapplied", () => {
    const r = planAllocation(300, [{ invoice_id: "a", outstanding: 100 }]);
    expect(r.applied_total).toBe(100);
    expect(r.unapplied).toBe(200);
  });
  test("rejects non-positive", () => {
    expect(() => planAllocation(0, [])).toThrow();
  });
});

describe("dunning policy", () => {
  const policy = [
    { min_days: 7, level: 1, template: "reminder1" },
    { min_days: 30, level: 2, template: "reminder2" },
    { min_days: 60, level: 3, template: "legal" },
  ];
  test("picks highest matching threshold", () => {
    expect(dunningFor(45, policy).level).toBe(2);
    expect(dunningFor(90, policy).level).toBe(3);
    expect(dunningFor(3, policy)).toBeNull();
  });
  test("daysOverdue sign", () => {
    expect(daysOverdue("2026-07-01", "2026-07-11")).toBe(10);
    expect(daysOverdue("2026-08-01", "2026-07-11")).toBeLessThan(0);
  });
});
