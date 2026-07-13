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
const { enqueue } = require("../../../jobs/queue-producer");
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

// ── Scheduled reports (1.3) ──

// cadence → the next fire time from `from`. on_event is not time-driven (null).
function nextRunAt(cadence, from = new Date()) {
  const d = new Date(from);
  switch (cadence) {
    case "daily": d.setUTCDate(d.getUTCDate() + 1); return d;
    case "weekly": d.setUTCDate(d.getUTCDate() + 7); return d;
    case "monthly": d.setUTCMonth(d.getUTCMonth() + 1); return d;
    case "quarterly": d.setUTCMonth(d.getUTCMonth() + 3); return d;
    default: return null; // on_event / unknown
  }
}

async function createSchedule(client, { input, actor = {} }) {
  if (!REPORTS[input.report_key]) throw new AppError("UNKNOWN_REPORT", "No report '" + input.report_key + "'. See /reports/catalogue.", 422);
  const first = input.cadence === "on_event" ? null : nextRunAt(input.cadence, new Date());
  const row = await repo.insertScheduled(client, {
    name: input.name, report_key: input.report_key, params: input.params || {},
    cadence: input.cadence, recipients: input.recipients || [], formats: input.formats || ["pdf"],
    active: input.active !== false, next_run_at: first, created_by: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.SCHEDULE_SET, moduleKey: events.MODULE, entityRef: "scheduled_report:" + row.scheduled_report_id, after: row });
  return row;
}
const listSchedules = (client, q) => repo.listScheduled(client, { limit: q.limit, offset: q.offset });
async function updateSchedule(client, { id, patch, actor = {} }) {
  if (patch.report_key && !REPORTS[patch.report_key]) throw new AppError("UNKNOWN_REPORT", "No report '" + patch.report_key + "'", 422);
  const before = await repo.getScheduled(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Scheduled report not found", 404);
  // A cadence change re-bases the next fire time from now (on_event clears it).
  if (patch.cadence !== undefined) patch.next_run_at = patch.cadence === "on_event" ? null : nextRunAt(patch.cadence, new Date());
  const row = await repo.updateScheduled(client, id, patch);
  await audit(client, { actorUserId: actor.user_id || null, action: events.SCHEDULE_SET, moduleKey: events.MODULE, entityRef: "scheduled_report:" + id, before, after: row });
  return row;
}
async function deleteSchedule(client, { id, actor = {} }) {
  const ok = await repo.deleteScheduled(client, id);
  if (!ok) throw new AppError("NOT_FOUND", "Scheduled report not found", 404);
  await audit(client, { actorUserId: actor.user_id || null, action: events.SCHEDULE_DELETED, moduleKey: events.MODULE, entityRef: "scheduled_report:" + id });
  return { deleted: true };
}

/**
 * Generate + deliver every due scheduled report, then advance each next_run_at.
 * Triggered per-tenant by the worker (jobs/handlers/scheduled-report.js) or
 * directly via POST /reports/scheduled/run-due. `tenantMeta`+`env` are needed to
 * enqueue the per-tenant email deliveries (the email sender identity is
 * per-tenant/per-purpose). A single report's failure is isolated — it still
 * advances so one bad run can't wedge the schedule.
 */
async function runDue(client, { tenantMeta = null, env = "live", actor = {} } = {}) {
  const due = await repo.listDueScheduled(client);
  const results = [];
  for (const sr of due) {
    let ok = true;
    try {
      // eslint-disable-next-line no-await-in-loop
      const out = await run(client, { reportKey: sr.report_key, params: sr.params || {} });
      const html = "<h1>" + sr.name + "</h1><pre>" + JSON.stringify(out.data, null, 2) + "</pre>";
      if (tenantMeta && Array.isArray(sr.recipients)) {
        for (const to of sr.recipients) {
          // eslint-disable-next-line no-await-in-loop
          await enqueue("email", "scheduled-report", { tenantMeta, env, to, subject: sr.name, html, purpose: "reports", moduleKey: events.MODULE });
        }
      }
    } catch (err) {
      ok = false;
    }
    const next = sr.cadence === "on_event" ? null : nextRunAt(sr.cadence, new Date());
    // eslint-disable-next-line no-await-in-loop
    await repo.markScheduledRan(client, sr.scheduled_report_id, next);
    // eslint-disable-next-line no-await-in-loop
    await audit(client, { actorUserId: actor.user_id || null, action: events.SCHEDULE_RAN, moduleKey: events.MODULE, entityRef: "scheduled_report:" + sr.scheduled_report_id, after: { ok, next_run_at: next } });
    results.push({ scheduled_report_id: sr.scheduled_report_id, ok, next_run_at: next });
  }
  return { ran: results.length, results };
}

module.exports = {
  catalogue, run, saveReport, listSaved, deleteSaved, runSaved, listTiles, setTile,
  createSchedule, listSchedules, updateSchedule, deleteSchedule, runDue,
};
