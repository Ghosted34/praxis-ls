/**
 * Payroll computation engine (MOD-17) — pure, deterministic, no I/O (KB §9).
 *
 * Cameroon payroll splits one gross into employee withholdings + employer
 * charges. Every rate here is a DEFAULT that a tenant overrides via the run's
 * config snapshot (BUILD_CONVENTIONS §6 — rates are configuration, effective-
 * dated, never hard law). Payslips are computed ESTIMATES until validated by an
 * expert-comptable (KB §9 disclaimer).
 */
"use strict";

// KB §9.1 / §9.2 defaults (2025/26). Override per-tenant via config_snapshot.
const DEFAULTS = {
  cnps_pension_rate: 0.042,          // employee + employer each
  cnps_ceiling: 750000,              // monthly base cap for pension/family
  cnps_family_rate: 0.07,            // employer
  cnps_injury_rate_default: 0.0175,  // employer, overridden by employee.risk_class_rate
  cfc_employee_rate: 0.01,
  cfc_employer_rate: 0.015,
  fne_rate: 0.01,                    // employer
  frais_pro_rate: 0.30,              // 30% professional allowance (IRPP base)
  monthly_abatement: 41667,          // 500,000 / 12
  cac_rate: 0.10,                    // 10% surtax on IRPP
  // Annual IRPP barème (net taxable). Base rates; CAC added separately.
  irpp_brackets: [
    { upTo: 2000000, rate: 0.10 },
    { upTo: 3000000, rate: 0.15 },
    { upTo: 5000000, rate: 0.25 },
    { upTo: Infinity, rate: 0.35 },
  ],
};

const round = (n) => Math.round(Number(n) * 100) / 100;

/** Progressive tax over ordered brackets [{upTo, rate}]. */
function progressive(base, brackets) {
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    if (base <= lower) break;
    const slice = Math.min(base, b.upTo) - lower;
    if (slice > 0) tax += slice * b.rate;
    lower = b.upTo;
  }
  return tax;
}

/**
 * Compute one monthly payslip.
 * @param employee { base_salary, risk_class_rate }
 * @param opts     { gross? overrides base_salary, config? overrides DEFAULTS }
 * @returns { gross, employee:{...}, employer:{...}, total_employee_deductions,
 *            total_employer_charges, net_pay, employer_cost }
 */
function computePayslip(employee = {}, opts = {}) {
  const c = { ...DEFAULTS, ...(opts.config || {}) };
  const gross = round(opts.gross ?? (employee.base_salary || 0));

  // --- Employee withholdings ---
  const cnpsBase = Math.min(gross, c.cnps_ceiling);
  const cnps_pension = round(cnpsBase * c.cnps_pension_rate);
  const cfc_ee = round(gross * c.cfc_employee_rate);

  // IRPP base (KB §9.2): (gross − CNPS) × 70% − abatement, annualised.
  const monthlyNetTaxable = Math.max(0, (gross - cnps_pension) * (1 - c.frais_pro_rate) - c.monthly_abatement);
  const annualNetTaxable = monthlyNetTaxable * 12;
  const irpp = round(progressive(annualNetTaxable, c.irpp_brackets) / 12);
  const cac = round(irpp * c.cac_rate);

  const total_employee_deductions = round(cnps_pension + cfc_ee + irpp + cac);
  const net_pay = round(gross - total_employee_deductions);

  // --- Employer charges ---
  const injuryRate = Number(employee.risk_class_rate) > 0 ? Number(employee.risk_class_rate) : c.cnps_injury_rate_default;
  const emp_pension = round(cnpsBase * c.cnps_pension_rate);
  const emp_family = round(cnpsBase * c.cnps_family_rate);
  const emp_injury = round(gross * injuryRate);
  const emp_cfc = round(gross * c.cfc_employer_rate);
  const emp_fne = round(gross * c.fne_rate);
  const total_employer_charges = round(emp_pension + emp_family + emp_injury + emp_cfc + emp_fne);

  return {
    gross,
    employee: { cnps_pension, cfc: cfc_ee, irpp, cac },
    employer: { pension: emp_pension, family: emp_family, injury: emp_injury, cfc: emp_cfc, fne: emp_fne },
    total_employee_deductions,
    total_employer_charges,
    net_pay,
    employer_cost: round(gross + total_employer_charges),
    estimate: true, // KB §9 — labelled estimate until professionally validated
  };
}

module.exports = { DEFAULTS, progressive, computePayslip };
