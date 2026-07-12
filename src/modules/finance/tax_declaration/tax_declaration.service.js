/**
 * Tax Center (MOD-07, KB §15/§16/§17) — computes returns over the validated GL.
 * Read-only; rates come from tenant settings (finance.tax) with KB defaults.
 * Outputs (PRD §12.4): TVA return, IS/minimum tax, withholding return, CNPS
 * declaration (DIPE) and the DSF dataset — all derived from live data, never
 * re-keyed.
 */
"use strict";
const statementsRepo = require("../financial_statement/financial_statement.repo");
const { incomeStatement, balanceSheet } = require("../financial_statement/financial_statement.rules");
const rules = require("./tax_declaration.rules");
const payrollRepo = require("../../hr/payroll/payroll.repo");
const { getSetting } = require("../../../shared/config/settings");

async function vatReturn(client, filters) {
  const rows = await statementsRepo.trialBalance(client, filters);
  return { period: filters, ...rules.vatReturn(rows) };
}

async function corporateTax(client, filters) {
  const rows = await statementsRepo.trialBalance(client, filters);
  const cr = incomeStatement(rows);
  const turnover = rules.turnoverFrom(rows);
  const cfg = (await getSetting(client, "finance", "tax", null)) || {};
  const isRate = typeof cfg.is_rate === "number" ? cfg.is_rate : 0.33;
  const minRate = typeof cfg.min_rate === "number" ? cfg.min_rate : 0.022;
  return { period: filters, ...rules.corporateTax({ result: cr.result, turnover, isRate, minRate }) };
}

/** Withholding-tax return (KB §17): 447 payable to remit + 449 précompte suffered. */
async function withholdingReturn(client, filters) {
  const rows = await statementsRepo.trialBalance(client, filters);
  return { period: filters, ...rules.withholdingReturn(rows) };
}

/**
 * CNPS declaration (DIPE) for an entity + period_code, aggregated from that
 * period's payroll run (per-employee social base + contributions). Returns an
 * empty declaration if no run exists for the period.
 */
async function cnpsDeclaration(client, { entityId, periodCode }) {
  const cfg = (await getSetting(client, "finance", "payroll", null)) || {};
  const ceiling = typeof cfg.cnps_ceiling === "number" ? cfg.cnps_ceiling : 750000;
  if (!entityId || !periodCode) {
    return { period: { entity_id: entityId, period_code: periodCode }, ...rules.cnpsSummary([], { ceiling }) };
  }
  const run = await payrollRepo.runByPeriod(client, entityId, periodCode);
  const items = run ? await payrollRepo.listItems(client, run.payroll_run_id) : [];
  return {
    period: { entity_id: entityId, period_code: periodCode },
    run_status: run ? run.status : null,
    ...rules.cnpsSummary(items, { ceiling }),
  };
}

/** DSF dataset (annual, OHADA/SYSCOHADA format) assembled from the validated GL. */
async function dsfDataset(client, filters) {
  const rows = await statementsRepo.trialBalance(client, filters);
  const cr = incomeStatement(rows);
  const bs = { ...balanceSheet(rows, cr.result), result: cr.result };
  const turnover = rules.turnoverFrom(rows);
  const cfg = (await getSetting(client, "finance", "tax", null)) || {};
  const isRate = typeof cfg.is_rate === "number" ? cfg.is_rate : 0.33;
  const minRate = typeof cfg.min_rate === "number" ? cfg.min_rate : 0.022;
  const ct = rules.corporateTax({ result: cr.result, turnover, isRate, minRate });
  return {
    period: filters,
    ...rules.dsfDataset(rows, { incomeStatement: cr, balanceSheet: bs, corporateTax: ct }),
  };
}

module.exports = { vatReturn, corporateTax, withholdingReturn, cnpsDeclaration, dsfDataset };
