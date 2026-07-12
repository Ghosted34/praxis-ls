/**
 * Reporting & Insights (MOD-63). A read-first module: `run(reportKey, params)`
 * dispatches to a registry of report producers — most delegate to the finance/
 * costing/operations services that already own the maths (single source of
 * truth), a few are this module's own cross-module rollups (repo). Also persists
 * saved reports and a user's dashboard-tile layout. Powers chat-on-dashboards via
 * the .ai.js read tools. All SQL is in the repo.
 */
"use strict";

const repo = require("./report.repo");
const events = require("./report.events");
const statements = require("../../finance/financial_statement/financial_statement.service");
const receivables = require("../../finance/smart_receivables/smart_receivables.service");
const dossier = require("../../operations/operations_file/operations_file.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

// report_key -> { describe, run(client, params) }
const REPORTS = {
  income_statement: { describe: "OHADA Compte de résultat for a period.", run: (c, p) => statements.compteDeResultat(c, p) },
  balance_sheet: { describe: "OHADA Bilan as of a date.", run: (c, p) => statements.bilan(c, p) },
  trial_balance: { describe: "Trial balance for a period.", run: (c, p) => statements.trialBalance(c, p) },
  cash_flow: { describe: "TAFIRE cash-flow (operating/investing/financing).", run: (c, p) => statements.cashFlow(c, p) },
  receivables_ageing: { describe: "Customer receivables ageing buckets.", run: (c, p) => receivables.ageing(c, p) },
  receivables_reminders: { describe: "Overdue invoices needing dunning.", run: (c, p) => receivables.reminders(c, p) },
  dossier_360: { describe: "360° view of one dossier (needs dossier_id).", run: (c, p) => dossier.overview(c, p.dossier_id) },
  cash_position: { describe: "Cash balance per treasury (class-5) account.", run: (c, p) => repo.cashPosition(c, p) },
  procurement_spend: { describe: "PO + posted supplier-invoice spend for a period.", run: (c, p) => repo.procurementSpend(c, p) },
  dossier_margin_portfolio: { describe: "Billed vs actual cost + margin per dossier.", run: (c, p) => repo.dossierMarginPortfolio(c, p) },
};

const catalogue = () => Object.entries(REPORTS).map(([key, r]) => ({ report_key: key, describe: r.describe }));

async function run(client, { reportKey, params = {} }) {
  const r = REPORTS[reportKey];
  if (!r) throw new AppError("UNKNOWN_REPORT", "No report '" + reportKey + "'. See /reports/catalogue.", 404);
  const data = await r.run(client, params || {});
  return { report_key: reportKey, params, data };
}

// ── Saved reports ──
async function saveReport(client, { name, reportKey, params = {}, isShared = false, actor = {} }) {
  if (!REPORTS[reportKey]) throw new AppError("UNKNOWN_REPORT", "No report '" + reportKey + "'", 422);
  const row = await repo.insertSaved(client, { name, report_key: reportKey, params: JSON.stringify(params || {}), owner_user_id: actor.user_id || null, is_shared: isShared === true });
  await emitEvent(client, { eventTypeKey: events.REPORT_SAVED, moduleKey: events.MODULE, entityRef: "saved_report:" + row.saved_report_id, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.REPORT_SAVED, moduleKey: events.MODULE, entityRef: "saved_report:" + row.saved_report_id, after: row });
  return row;
}
const listSaved = (client, q, actor) => repo.listSaved(client, { userId: actor.user_id, limit: q.limit, offset: q.offset });
async function deleteSaved(client, { id, actor = {} }) {
  const ok = await repo.deleteSaved(client, id, actor.user_id || null);
  if (!ok) throw new AppError("NOT_FOUND", "Saved report not found or not yours", 404);
  await audit(client, { actorUserId: actor.user_id || null, action: events.REPORT_DELETED, moduleKey: events.MODULE, entityRef: "saved_report:" + id });
  return { deleted: true };
}
/** Run a saved report by id (merging any ad-hoc param overrides). */
async function runSaved(client, { id, overrides = {}, actor = {} }) {
  const saved = await repo.getSaved(client, id);
  if (!saved) throw new AppError("NOT_FOUND", "Saved report not found", 404);
  if (!saved.is_shared && saved.owner_user_id !== (actor.user_id || null)) throw new AppError("FORBIDDEN", "Not your report", 403);
  return run(client, { reportKey: saved.report_key, params: { ...saved.params, ...overrides } });
}

// ── Dashboard tiles ──
const listTiles = (client, actor) => repo.listTiles(client, actor.user_id);
async function setTile(client, { tileKey, position, isVisible, config, actor = {} }) {
  const row = await repo.upsertTile(client, { userId: actor.user_id, tileKey, position, isVisible, config });
  await audit(client, { actorUserId: actor.user_id || null, action: events.TILE_SET, moduleKey: events.MODULE, entityRef: "dashboard_tile:" + tileKey, after: row });
  return row;
}

module.exports = { catalogue, run, saveReport, listSaved, deleteSaved, runSaved, listTiles, setTile };
