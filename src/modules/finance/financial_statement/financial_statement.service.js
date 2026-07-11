/**
 * Statements (MOD-59, KB §12). Reads the validated GL into a trial balance, then
 * derives the Compte de résultat and a first-cut Bilan. Read-only.
 */
"use strict";
const repo = require("./financial_statement.repo");
const { trialBalanceTotals, incomeStatement, balanceSheet, runningBalance, tafire } = require("./financial_statement.rules");

async function trialBalance(client, filters) {
  const rows = await repo.trialBalance(client, filters);
  return { rows, totals: trialBalanceTotals(rows) };
}

async function compteDeResultat(client, filters) {
  const rows = await repo.trialBalance(client, filters);
  return incomeStatement(rows);
}

async function bilan(client, filters) {
  const rows = await repo.trialBalance(client, filters);
  const cr = incomeStatement(rows);
  return { ...balanceSheet(rows, cr.result), result: cr.result };
}


async function grandLivre(client, { accountCode, entityId, from, to }) {
  const rows = await repo.accountMovements(client, { accountCode, entityId, from, to });
  return { account_code: accountCode, movements: runningBalance(rows, 0), count: rows.length };
}

async function cashFlow(client, filters) {
  const cash = await repo.cashFlow(client, filters);
  const sections = await repo.cashFlowSections(client, filters);
  return { period: filters, inflows: cash.inflows, outflows: cash.outflows, ...tafire({ opening_cash: cash.opening_cash, ...sections }) };
}

module.exports = { trialBalance, compteDeResultat, bilan, grandLivre, cashFlow };
