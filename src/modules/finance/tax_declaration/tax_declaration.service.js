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
const repo = require("./tax_declaration.repo");
const events = require("./tax_declaration.events");
const payrollRepo = require("../../hr/payroll/payroll.repo");
const { getSetting } = require("../../../shared/config/settings");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

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

// ── Filing workflow (persist a computed return + move it through the tax_declaration
//    status machine DRAFT→COMPUTED→APPROVED→FILED→PAID) ──

/** Dispatch a declaration kind to the matching read-model computation. */
async function computeDataset(client, kind, filters) {
  switch (kind) {
    case "TVA": return vatReturn(client, filters);
    case "IS":
    case "MIN_TAX": return corporateTax(client, filters);
    case "WHT": return withholdingReturn(client, filters);
    case "CNPS":
    case "DIPE": return cnpsDeclaration(client, { entityId: filters.entity_id, periodCode: filters.period_code });
    case "DSF": return dsfDataset(client, filters);
    case "PATENTE": return { period: filters }; // no GL computation; amount keyed manually later
    default: throw new AppError("BAD_KIND", "Unknown declaration kind: " + kind, 422);
  }
}

/** Extract the headline amount due from a computed dataset (kind-specific keys). */
function amountDueFor(kind, ds) {
  if (!ds || typeof ds !== "object") return null;
  switch (kind) {
    case "TVA": return typeof ds.vat_due === "number" ? ds.vat_due : null;
    case "IS":
    case "MIN_TAX": return typeof ds.tax_due === "number" ? ds.tax_due : null;
    case "WHT": return typeof ds.net_remittance === "number" ? ds.net_remittance : null;
    case "CNPS":
    case "DIPE": return ds.totals && typeof ds.totals.total === "number" ? ds.totals.total : null;
    default: return null; // DSF / PATENTE — no single amount
  }
}

/** Compute + persist a declaration (status COMPUTED). Upserts the period's row. */
async function fileDeclaration(client, { entityId, kind, periodCode, from, to, dueOn, actor = {} }) {
  if (!kind || !periodCode) throw new AppError("MISSING_FIELDS", "kind and period_code are required", 422);
  const filters = { entity_id: entityId, period_code: periodCode, from, to };
  const dataset = await computeDataset(client, kind, filters);
  const amount_due = amountDueFor(kind, dataset);
  const row = await repo.upsertDeclaration(client, { entity_id: entityId, kind, period_code: periodCode, computed_dataset: dataset, amount_due, status: "COMPUTED", due_on: dueOn });
  await emitEvent(client, { eventTypeKey: "tax_declaration.computed", moduleKey: events.MODULE, entityRef: "tax_declaration:" + row.tax_declaration_id, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: "tax_declaration.computed", moduleKey: events.MODULE, entityRef: "tax_declaration:" + row.tax_declaration_id, after: row });
  return row;
}

async function approveDeclaration(client, { id, actor = {} }) {
  const before = await repo.getDeclaration(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Tax declaration not found", 404);
  if (before.status !== "COMPUTED") throw new AppError("BAD_STATE", "Only a COMPUTED declaration can be approved (was " + before.status + ")", 409);
  const row = await repo.setStatus(client, id, { status: "APPROVED" });
  await audit(client, { actorUserId: actor.user_id || null, action: "tax_declaration.approved", moduleKey: events.MODULE, entityRef: "tax_declaration:" + id, before, after: row });
  return row;
}

/** File the declaration with the tax authority — records filed_on + filed_ref. */
async function submitDeclaration(client, { id, filedRef = null, actor = {} }) {
  const before = await repo.getDeclaration(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Tax declaration not found", 404);
  if (!["COMPUTED", "APPROVED"].includes(before.status)) {
    throw new AppError("BAD_STATE", "Only a COMPUTED/APPROVED declaration can be filed (was " + before.status + ")", 409);
  }
  const row = await repo.setStatus(client, id, { status: "FILED", filed_on: new Date().toISOString().slice(0, 10), filed_ref: filedRef });
  await emitEvent(client, { eventTypeKey: "tax_declaration.filed", moduleKey: events.MODULE, entityRef: "tax_declaration:" + id, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: "tax_declaration.filed", moduleKey: events.MODULE, entityRef: "tax_declaration:" + id, before, after: row });
  return row;
}

const listDeclarations = (client, q) => repo.listDeclarations(client, q);
async function getDeclaration(client, id) {
  const row = await repo.getDeclaration(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Tax declaration not found", 404);
  return row;
}

module.exports = {
  vatReturn, corporateTax, withholdingReturn, cnpsDeclaration, dsfDataset,
  fileDeclaration, approveDeclaration, submitDeclaration, listDeclarations, getDeclaration,
};
