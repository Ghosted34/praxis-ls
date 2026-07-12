/**
 * Tax Center computations (KB §15/§16/§17) — pure, no DB. Operates on a trial
 * balance (validated GL) so débours are already excluded from turnover/VAT
 * (they never touch class 7 or the VAT accounts, KB §6).
 */
"use strict";

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => Number(v || 0);
const bal = (r) => num(r.debit) - num(r.credit); // debit-positive
const starts = (code, p) => String(code).startsWith(p);

/**
 * TVA (VAT) return, KB §16. Output VAT (443/4432, credit balance) − input VAT
 * (445, debit balance). Net > 0 = due (4441); net < 0 = credit carried (4449).
 */
function vatReturn(rows) {
  let output = 0;
  let input = 0;
  for (const r of rows) {
    if (starts(r.account_code, "443")) output += -bal(r); // collected VAT is a credit balance
    else if (starts(r.account_code, "445")) input += bal(r); // recoverable VAT is a debit balance
  }
  output = round2(output);
  input = round2(input);
  const net = round2(output - input);
  return { output_vat: output, input_vat: input, net, vat_due: Math.max(net, 0), vat_credit: round2(Math.max(-net, 0)) };
}

/** Turnover (chiffre d'affaires) = class 70 credit balances. Débours excluded by design. */
function turnoverFrom(rows) {
  let ca = 0;
  for (const r of rows) if (starts(r.account_code, "70")) ca += -bal(r);
  return round2(ca);
}

/**
 * Corporate income tax + minimum tax, KB §15. IS on taxable profit vs a minimum
 * tax on TURNOVER (paid even at a loss); the greater is due. Rates configurable
 * (defaults: IS 33%, minimum 2.2% réel).
 */
function corporateTax({ result, turnover, isRate = 0.33, minRate = 0.022 }) {
  const isOnProfit = round2(Math.max(num(result), 0) * isRate);
  const minimumTax = round2(num(turnover) * minRate);
  return {
    taxable_profit: round2(Math.max(num(result), 0)),
    turnover: round2(num(turnover)),
    is_on_profit: isOnProfit,
    minimum_tax: minimumTax,
    tax_due: Math.max(isOnProfit, minimumTax),
    basis: minimumTax > isOnProfit ? "MINIMUM_TAX" : "IS",
  };
}

/**
 * Withholding-tax return (KB §17). Two flows over the validated GL:
 *   - Withheld & PAYABLE to the State (retenues à la source): account 447,
 *     credit balance — SmartLS withheld this from suppliers / non-resident SIT
 *     and must remit it. (4471 = IRPP+CAC on salaries; 4474 = WHT from suppliers.)
 *   - SUFFERED by SmartLS (précompte / advance on its own IS): account 449
 *     (4492), debit balance — a receivable that offsets the annual IS charge.
 * Débours never bear withholding (KB §6/§17), so they're already excluded.
 */
function withholdingReturn(rows) {
  let withheldPayable = 0; // 447 credit-positive
  let precompteSuffered = 0; // 449 debit-positive
  for (const r of rows) {
    if (starts(r.account_code, "447")) withheldPayable += -bal(r);
    else if (starts(r.account_code, "449")) precompteSuffered += bal(r);
  }
  withheldPayable = round2(withheldPayable);
  precompteSuffered = round2(precompteSuffered);
  return {
    withheld_payable: withheldPayable, // to remit to the State
    precompte_suffered: precompteSuffered, // receivable, offsets IS
    net_remittance: Math.max(withheldPayable, 0),
  };
}

/**
 * CNPS declaration (DIPE) from a period's payroll items (KB §9). Pure: takes the
 * per-employee rows [{ employee_name, cnps_number, gross, breakdown }] and
 * summarises the social base + employee/employer contributions per head and in
 * total. `breakdown.employer` carries pension/family/injury; `breakdown.employee`
 * carries the employee pension share. Ceiling-capped base is recomputed here so
 * the declaration is self-consistent regardless of how the run stored it.
 */
function cnpsSummary(items = [], { ceiling = 750000 } = {}) {
  const lines = [];
  const totals = { gross: 0, cnps_base: 0, employee_pension: 0, employer_pension: 0, employer_family: 0, employer_injury: 0, total: 0 };
  for (const it of items) {
    const b = it.breakdown || {};
    const emp = b.employee || {};
    const er = b.employer || {};
    const gross = num(it.gross);
    const base = Math.min(gross, ceiling);
    const employeePension = num(emp.cnps_pension);
    const employerPension = num(er.pension);
    const employerFamily = num(er.family);
    const employerInjury = num(er.injury);
    const total = round2(employeePension + employerPension + employerFamily + employerInjury);
    lines.push({
      employee_name: it.employee_name || null,
      cnps_number: it.cnps_number || null,
      gross: round2(gross),
      cnps_base: round2(base),
      employee_pension: round2(employeePension),
      employer_pension: round2(employerPension),
      employer_family: round2(employerFamily),
      employer_injury: round2(employerInjury),
      total_cnps: total,
    });
    totals.gross += gross;
    totals.cnps_base += base;
    totals.employee_pension += employeePension;
    totals.employer_pension += employerPension;
    totals.employer_family += employerFamily;
    totals.employer_injury += employerInjury;
    totals.total += total;
  }
  for (const k of Object.keys(totals)) totals[k] = round2(totals[k]);
  return { headcount: lines.length, lines, totals };
}

/**
 * DSF dataset (Déclaration Statistique et Fiscale, KB §15 note) — the annual
 * OHADA/SYSCOHADA-format dataset assembled from the validated GL. Not a re-keyed
 * form: a structured export of the trial balance grouped by SYSCOHADA class, the
 * Compte de résultat result, the Bilan totals and the tax computation, so the
 * accountant files from live data. `statements` supplies the already-computed
 * income statement + balance sheet + corporate tax to avoid recomputation drift.
 */
function dsfDataset(rows, { incomeStatement, balanceSheet, corporateTax: ct } = {}) {
  const byClass = {};
  for (let cls = 1; cls <= 9; cls += 1) byClass[cls] = { debit: 0, credit: 0, balance: 0 };
  for (const r of rows) {
    const cls = parseInt(String(r.account_code)[0], 10);
    if (!byClass[cls]) continue;
    byClass[cls].debit += num(r.debit);
    byClass[cls].credit += num(r.credit);
  }
  for (const cls of Object.keys(byClass)) {
    byClass[cls].debit = round2(byClass[cls].debit);
    byClass[cls].credit = round2(byClass[cls].credit);
    byClass[cls].balance = round2(byClass[cls].debit - byClass[cls].credit);
  }
  return {
    format: "OHADA_SYSCOHADA",
    classes: byClass,
    income_statement: incomeStatement || null,
    balance_sheet: balanceSheet || null,
    corporate_tax: ct || null,
  };
}

module.exports = { vatReturn, turnoverFrom, corporateTax, withholdingReturn, cnpsSummary, dsfDataset, bal };
