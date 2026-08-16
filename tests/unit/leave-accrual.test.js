"use strict";
/**
 * The monthly accrual job (0696).
 *
 * TWO PROPERTIES ARE LOAD-BEARING, and neither is visible by reading the happy
 * path:
 *
 *   IT IS FREE TO RE-RUN. A monthly job gets re-run by hand — after a deploy,
 *   after a failure, after somebody wonders whether it ran. Without the unique
 *   index behind `insertAccrual`, the second run would hand every employee
 *   another month of leave, and nothing downstream would flag it because a
 *   larger balance looks like a happier employee.
 *
 *   IT STOPS AT THE CEILING. `max_days_per_year` is enforced against the LEDGER
 *   rather than against a count of months, so a hand adjustment or a partial
 *   earlier run cannot push the year past its cap.
 *
 * The repo is faked rather than mocked at the SQL level: what is under test is
 * the loop's arithmetic and its stopping conditions, and a fake that enforces
 * the unique index is a truer stand-in for Postgres here than a query spy.
 */

const repo = require("../../src/modules/hr/leave_allowance/leave_allowance.repo");
const { accrueOn } = require("../../src/jobs/handlers/leave-accrual");

const ANNUAL = {
  leave_type_id: "type-annual",
  code: "ANNUAL",
  name: "Annual leave",
  accrual_days_per_month: 1.5,
  max_days_per_year: null,
  is_active: true,
};
const SICK = {
  leave_type_id: "type-sick",
  code: "SICK",
  name: "Sick leave",
  // Granted per event, never banked — the job must not touch it.
  accrual_days_per_month: null,
  max_days_per_year: 30,
  is_active: true,
};

/** Stands in for the ledger, including the partial unique index that makes a
 *  re-run a no-op. */
function fakeLedger({ types = [ANNUAL, SICK], roster, seed = [] } = {}) {
  const rows = [...seed];
  jest.spyOn(repo, "listTypes").mockResolvedValue(types);
  jest.spyOn(repo, "accrualRoster").mockResolvedValue(roster);
  jest.spyOn(repo, "ledgerFor").mockImplementation(async (_c, { employeeId, leaveTypeId, year }) =>
    rows.filter((r) =>
      r.employee_id === employeeId &&
      (!leaveTypeId || r.leave_type_id === leaveTypeId) &&
      (!year || r.period_year === year)));
  jest.spyOn(repo, "insertAccrual").mockImplementation(async (_c, e) => {
    // ux_leave_ledger_accrual: one ACCRUAL per (employee, type, year, month).
    const clash = rows.some((r) =>
      r.kind === "ACCRUAL" && r.employee_id === e.employee_id && r.leave_type_id === e.leave_type_id &&
      r.period_year === e.period_year && r.period_month === e.period_month);
    if (clash) return null;
    const row = { ...e, kind: "ACCRUAL" };
    rows.push(row);
    return row;
  });
  return rows;
}

const TODAY = new Date("2026-04-16T00:00:00Z");
const ONE = [{ employee_id: "e1", full_name: "Ada", hired_on: "2026-01-01" }];

describe("leave accrual", () => {
  afterEach(() => jest.restoreAllMocks());

  it("posts one entry per completed month of service", async () => {
    const rows = fakeLedger({ roster: ONE });
    const out = await accrueOn({}, { today: TODAY });

    expect(out.posted).toBe(4); // January through April
    expect(rows.map((r) => r.period_month)).toEqual([1, 2, 3, 4]);
    expect(rows.every((r) => r.days === 1.5)).toBe(true);
  });

  it("posts nothing on a second run", async () => {
    const rows = fakeLedger({ roster: ONE });
    await accrueOn({}, { today: TODAY });
    const second = await accrueOn({}, { today: TODAY });

    // The property the whole design rests on: re-running is free, not a
    // doubling that nobody would notice.
    expect(second.posted).toBe(0);
    expect(rows).toHaveLength(4);
  });

  it("never accrues a type that is granted per event", async () => {
    const rows = fakeLedger({ roster: ONE });
    await accrueOn({}, { today: TODAY });

    // Sick leave with a null rate would otherwise show as "6 days saved up",
    // which is not what sick leave is.
    expect(rows.some((r) => r.leave_type_id === SICK.leave_type_id)).toBe(false);
  });

  it("stops at the annual ceiling, part-way through a month if it has to", async () => {
    const capped = { ...ANNUAL, max_days_per_year: 5 };
    const rows = fakeLedger({ types: [capped], roster: ONE });
    await accrueOn({}, { today: TODAY });

    // 1.5 + 1.5 + 1.5 = 4.5, then 0.5 to reach the cap and nothing after.
    expect(rows.map((r) => r.days)).toEqual([1.5, 1.5, 1.5, 0.5]);
    expect(rows.reduce((n, r) => n + r.days, 0)).toBe(5);
  });

  it("counts a hand adjustment against the ceiling", async () => {
    // The cap is enforced against the ledger, not against a month count — so
    // days granted by hand reduce what the job will add.
    const capped = { ...ANNUAL, max_days_per_year: 5 };
    const rows = fakeLedger({
      types: [capped],
      roster: ONE,
      seed: [{ employee_id: "e1", leave_type_id: "type-annual", period_year: 2026, period_month: 1, kind: "ACCRUAL", days: 4 }],
    });
    await accrueOn({}, { today: TODAY });

    expect(rows.reduce((n, r) => n + r.days, 0)).toBe(5);
    // January was already posted, so the top-up lands on February and stops.
    expect(rows.filter((r) => r.period_month === 2).map((r) => r.days)).toEqual([1]);
    expect(rows.some((r) => r.period_month === 3)).toBe(false);
  });

  it("skips the month somebody joined part-way through", async () => {
    const rows = fakeLedger({ roster: [{ employee_id: "e2", full_name: "Bo", hired_on: "2026-02-14" }] });
    await accrueOn({}, { today: TODAY });

    expect(rows.map((r) => r.period_month)).toEqual([3, 4]);
  });

  it("does nothing at all when no type accrues", async () => {
    const rows = fakeLedger({ types: [SICK], roster: ONE });
    const out = await accrueOn({}, { today: TODAY });

    expect(out.posted).toBe(0);
    expect(rows).toHaveLength(0);
    // And it does not even read the roster — there is nothing to accrue.
    expect(repo.accrualRoster).not.toHaveBeenCalled();
  });
});
