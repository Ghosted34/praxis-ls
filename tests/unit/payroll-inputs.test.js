"use strict";
/**
 * What a payslip is allowed to read (0698).
 *
 * ── THE DISTINCTION THESE EXIST TO PROTECT ─────────────────────────────────
 *
 * Two kinds of thing come off a payslip, and confusing them mis-taxes the
 * employee in one direction or the other:
 *
 *   OFF GROSS — absence, unjustified lateness, unpaid leave. The employee did
 *   not work the time and did not EARN the money, so CNPS and IRPP are computed
 *   on the smaller figure. Deducting it from net would tax them on pay they
 *   never received.
 *
 *   OFF NET — recovering a salary advance. They earned the full salary and were
 *   taxed on it; in an earlier month they simply received part of it early.
 *   Taking it off gross would hand them a tax rebate for having been lent money.
 *
 * The first three tests assert exactly that, by checking the WITHHOLDINGS move
 * in one case and not the other — which is the only way the difference shows.
 */

const { computePayslip } = require("../../src/modules/hr/payroll/payroll.rules");

const EMP = { base_salary: 500000 };

describe("time not worked comes off gross", () => {
  it("reduces the statutory withholdings, not just the take-home", () => {
    const full = computePayslip(EMP);
    // One day absent on a 22-day month at 500,000.
    const short = computePayslip(EMP, { gross: 500000 - 22727.27 });

    expect(short.gross).toBeLessThan(full.gross);
    // The point: they did not earn it, so they are not taxed on it. If the
    // deduction had been applied post-tax these would be equal.
    expect(short.employee.irpp).toBeLessThan(full.employee.irpp);
    expect(short.employee.cnps_pension).toBeLessThan(full.employee.cnps_pension);
    // …and the employer's charges fall with it, which is the other half of the
    // same fact.
    expect(short.total_employer_charges).toBeLessThan(full.total_employer_charges);
  });
});

describe("an advance comes off net", () => {
  it("leaves every statutory figure untouched", () => {
    const plain = computePayslip(EMP);
    const withRecovery = computePayslip(EMP, {
      post_tax_deductions: [{ label: "Salary advance", amount: 50000 }],
    });

    // Same earnings, same tax — they earned the full salary and were taxed on
    // it. Only the take-home moves.
    expect(withRecovery.gross).toBe(plain.gross);
    expect(withRecovery.employee.irpp).toBe(plain.employee.irpp);
    expect(withRecovery.employee.cnps_pension).toBe(plain.employee.cnps_pension);
    expect(withRecovery.total_employee_deductions).toBe(plain.total_employee_deductions);
    expect(withRecovery.net_before_recovery).toBe(plain.net_pay);
    expect(withRecovery.net_pay).toBe(Math.round((plain.net_pay - 50000) * 100) / 100);
    expect(withRecovery.total_post_tax_deductions).toBe(50000);
  });

  it("never produces a negative payslip", () => {
    // An instalment larger than the month's net must take what is there and no
    // more. The rest stays owing — the recovery plan is the record of it — and
    // the employee takes home zero rather than seeing a debt on a payslip.
    const slip = computePayslip(EMP, {
      post_tax_deductions: [{ label: "Salary advance", amount: 10_000_000 }],
    });
    expect(slip.net_pay).toBe(0);
    expect(slip.total_post_tax_deductions).toBe(slip.net_before_recovery);
    // What was ASKED for is kept beside what was taken, so the caller can see
    // the shortfall rather than believing the instalment was met.
    expect(slip.post_tax_deductions[0].requested).toBe(10_000_000);
    expect(slip.post_tax_deductions[0].amount).toBeLessThan(10_000_000);
  });

  it("stops taking once nothing is left, rather than going negative on the second line", () => {
    const slip = computePayslip(EMP, {
      post_tax_deductions: [
        { label: "Advance A", amount: 400000 },
        { label: "Advance B", amount: 400000 },
      ],
    });
    expect(slip.net_pay).toBe(0);
    expect(slip.total_post_tax_deductions).toBe(slip.net_before_recovery);
    // The second line is capped at the remainder, not dropped and not doubled.
    const taken = slip.post_tax_deductions.reduce((n, d) => n + d.amount, 0);
    expect(Math.round(taken * 100) / 100).toBe(slip.net_before_recovery);
  });

  it("ignores a zero or negative instalment rather than crediting it", () => {
    // A malformed plan must not ADD to somebody's pay.
    const slip = computePayslip(EMP, {
      post_tax_deductions: [{ label: "Nothing", amount: 0 }, { label: "Wrong", amount: -5000 }],
    });
    expect(slip.total_post_tax_deductions).toBe(0);
    expect(slip.net_pay).toBe(slip.net_before_recovery);
  });
});

describe("the two together", () => {
  it("taxes the reduced gross and then recovers from what is left", () => {
    const gross = 450000; // a month with 50,000 of unpaid absence
    const slip = computePayslip(EMP, {
      gross,
      post_tax_deductions: [{ label: "Salary advance", amount: 30000 }],
    });
    const reference = computePayslip(EMP, { gross });

    // Statutory figures follow the reduced gross …
    expect(slip.total_employee_deductions).toBe(reference.total_employee_deductions);
    // … and the advance comes out afterwards.
    expect(slip.net_pay).toBe(Math.round((reference.net_pay - 30000) * 100) / 100);
  });
});

describe("an unchanged payslip", () => {
  it("still reports the same figures when nothing is deducted", () => {
    // The new fields must not disturb the existing engine: a month with no
    // attendance, no leave and no advance is the payslip it always was.
    const slip = computePayslip(EMP);
    expect(slip.net_pay).toBe(slip.net_before_recovery);
    expect(slip.total_post_tax_deductions).toBe(0);
    expect(slip.post_tax_deductions).toEqual([]);
    expect(slip.estimate).toBe(true);
  });
});
