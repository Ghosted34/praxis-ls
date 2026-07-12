/**
 * Statements (MOD-59, KB §12). Reads the validated GL into a trial balance, then
 * derives the Compte de résultat, Bilan, Notes annexes, TAFIRE — plus the guided
 * monthly close (period freeze/lock). Statement reads are read-only; the close is
 * the one write, gated on a balanced trial balance.
 */
"use strict";
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const repo = require("./financial_statement.repo");
const { trialBalanceTotals, incomeStatement, balanceSheet, runningBalance, tafire, notesAnnexes, canClosePeriod } = require("./financial_statement.rules");

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

async function notes(client, filters) {
  const rows = await repo.trialBalance(client, filters);
  return { period: filters, ...notesAnnexes(rows) };
}

/** List accounting periods (guided-close surface). */
async function listPeriods(client, filters = {}) {
  return { periods: await repo.listPeriods(client, { entityId: filters.entityId }) };
}

/**
 * Guided monthly close (MOD-59, KB §12 intangibility). Freeze (soft lock) or
 * close a period once its validated GL balances; the ledger post-guard already
 * rejects new entries into a non-OPEN period. Emits + audits the transition.
 */
async function closePeriod(client, { periodId, to = "CLOSED", actor = {} }) {
  const period = await repo.getPeriod(client, periodId);
  if (!period) throw new AppError("NO_PERIOD", "Accounting period not found", 404);
  if (period.status === "CLOSED") throw new AppError("ALREADY_CLOSED", "Period is already closed", 422);
  const rows = await repo.trialBalanceForPeriod(client, periodId);
  const gate = canClosePeriod(rows, to);
  if (!gate.ok) throw new AppError("CLOSE_BLOCKED", gate.reason, 422, gate.totals || null);
  const updated = await repo.setPeriodStatus(client, periodId, to);
  const entityRef = "period:" + periodId;
  await emitEvent(client, { eventTypeKey: "period.closed", moduleKey: "MOD-59", entityRef, actorUserId: actor.user_id || null, payload: { from: period.status, to, code: period.code } });
  await audit(client, { actorUserId: actor.user_id || null, action: "period.closed", moduleKey: "MOD-59", entityRef, before: period, after: updated });
  return { period: updated, totals: gate.totals };
}

module.exports = { trialBalance, compteDeResultat, bilan, grandLivre, cashFlow, notes, listPeriods, closePeriod };
