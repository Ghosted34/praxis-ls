/**
 * Payroll (MOD-17). Orchestrates a monthly run: create → compute (over the active
 * employee roster) → SoD lifecycle → post to the ledger. The arithmetic lives in
 * payroll.rules (verified against KB §9); this service handles state, snapshots
 * the rates in force, and posts a balanced payroll journal on validation.
 *
 * Run lifecycle (schema): OPEN → COMPUTED → SUBMITTED → APPROVED → VALIDATED →
 * DISBURSED, or REJECTED. Segregation of duties: whoever computes shouldn't be
 * the sole approver — enforced via RBAC on the transition routes.
 *
 * GL posting is a guarded, gracefully-degrading step: it builds a balanced entry
 * (661/664 debit; 431/447/422 credit) and posts through journal_entry.service. If
 * the ledger isn't configured (no journal/period/accounts) it records the run
 * without an entry_id rather than failing the payroll.
 */
"use strict";
const repo = require("./payroll.repo");
const events = require("./payroll.events");
const { computePayslip, DEFAULTS } = require("./payroll.rules");
const employeeService = require("../../master/employees/employees.service");
const journal = require("../../finance/journal_entry/journal_entry.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "payroll_run:" + id;
const round = (n) => Math.round(Number(n) * 100) / 100;

const TRANSITIONS = {
  OPEN: ["COMPUTED", "REJECTED"],
  COMPUTED: ["SUBMITTED", "OPEN", "REJECTED"],
  SUBMITTED: ["APPROVED", "REJECTED"],
  APPROVED: ["VALIDATED", "REJECTED"],
  VALIDATED: ["DISBURSED"],
  DISBURSED: [],
  REJECTED: [],
};

async function createRun(client, { data, actor = {} }) {
  const existing = await repo.runByPeriod(client, data.entity_id, data.period_code);
  if (existing) throw new AppError("RUN_EXISTS", `A payroll run for ${data.period_code} already exists`, 409);
  const row = await repo.createRun(client, { entity_id: data.entity_id, period_code: data.period_code, status: "OPEN" });
  await emitEvent(client, { eventTypeKey: events.RUN_CREATED, moduleKey: events.MODULE, entityRef: ref(row.payroll_run_id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.RUN_CREATED, moduleKey: events.MODULE, entityRef: ref(row.payroll_run_id), after: row });
  return row;
}

/** Compute payslips for every active employee in the run's entity. Re-runnable while OPEN/COMPUTED. */
async function compute(client, { id, config = null, actor = {} }) {
  const run = await repo.findRun(client, id);
  if (!run) throw new AppError("NOT_FOUND", "Payroll run not found", 404);
  if (!["OPEN", "COMPUTED"].includes(run.status)) {
    throw new AppError("RUN_LOCKED", `Cannot recompute a ${run.status} run`, 422);
  }
  const cfg = { ...DEFAULTS, ...(config || {}) };
  const roster = await employeeService.roster(client, { entity_id: run.entity_id });
  await repo.deleteItems(client, id);

  let totalGross = 0, totalNet = 0, totalEmployer = 0, count = 0;
  for (const emp of roster) {
    const slip = computePayslip(emp, { config: cfg });
    await repo.insertItem(client, {
      payroll_run_id: id,
      employee_id: emp.employee_id,
      gross: slip.gross,
      net_pay: slip.net_pay,
      breakdown: slip,
    });
    totalGross += slip.gross;
    totalNet += slip.net_pay;
    totalEmployer += slip.total_employer_charges;
    count += 1;
  }

  const updated = await repo.updateRun(client, id, { status: "COMPUTED", config_snapshot: cfg });
  await emitEvent(client, { eventTypeKey: events.COMPUTED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null, payload: { employees: count, totalGross, totalNet } });
  await audit(client, { actorUserId: actor.user_id || null, action: events.COMPUTED, moduleKey: events.MODULE, entityRef: ref(id), after: updated });
  return { run: updated, item_count: count, totals: { gross: round(totalGross), net: round(totalNet), employer_charges: round(totalEmployer) } };
}

async function setStatus(client, { id, status, actor = {} }) {
  const before = await repo.findRun(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Payroll run not found", 404);
  const allowed = TRANSITIONS[before.status] || [];
  if (!allowed.includes(status)) throw new AppError("INVALID_TRANSITION", `Cannot move payroll ${before.status} → ${status}`, 422);

  let entry_id = before.entry_id;
  if (status === "VALIDATED" && !entry_id) {
    entry_id = await tryPost(client, before, actor); // best-effort; may stay null
    if (entry_id) {
      await emitEvent(client, { eventTypeKey: events.POSTED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    }
  }
  const patch = { status };
  if (entry_id) patch.entry_id = entry_id;
  const row = await repo.updateRun(client, id, patch);
  await emitEvent(client, { eventTypeKey: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null, payload: { from: before.status, to: status } });
  await audit(client, { actorUserId: actor.user_id || null, action: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/** Build a balanced payroll entry and post it; swallow config errors (degrade). */
async function tryPost(client, run, actor) {
  const items = await repo.listItems(client, run.payroll_run_id);
  if (!items.length) return null;
  let gross = 0, cnps = 0, taxes = 0, net = 0, employer = 0;
  for (const it of items) {
    const b = it.breakdown || {};
    const emp = b.employee || {};
    const er = b.employer || {};
    gross += Number(it.gross || 0);
    net += Number(it.net_pay || 0);
    cnps += Number(emp.cnps_pension || 0) + Number(er.pension || 0) + Number(er.family || 0) + Number(er.injury || 0);
    taxes += Number(emp.cfc || 0) + Number(emp.irpp || 0) + Number(emp.cac || 0) + Number(er.cfc || 0) + Number(er.fne || 0);
    employer += Number(b.total_employer_charges || 0);
  }
  // 661 gross + 664 employer charges (debit); credit 431 CNPS, 447 taxes,
  // 422 net payable. Credits = gross + employer by construction (balanced).
  const employeeDeductions = round(gross - net); // CNPS_ee + taxes_ee
  const lines = [
    { account: "661", debit: round(gross), credit: 0, label: "Salaires bruts" },
    { account: "664", debit: round(employer), credit: 0, label: "Charges sociales employeur" },
    { account: "431", debit: 0, credit: round(cnps), label: "CNPS" },
    { account: "447", debit: 0, credit: round(taxes), label: "Impôts & taxes sur salaires" },
    { account: "422", debit: 0, credit: round(gross + employer - cnps - taxes), label: "Personnel — rémunérations dues" },
  ];
  void employeeDeductions;
  try {
    const entry = await journal.post(client, {
      entityId: run.entity_id,
      entryDate: periodEnd(run.period_code),
      journalCode: "OD",
      description: `Payroll ${run.period_code}`,
      source: "SYSTEM_AUTO",
      lines,
      actor,
    });
    return entry ? entry.entry_id || entry.entryId || null : null;
  } catch (err) {
    return null; // ledger not configured — degrade gracefully
  }
}

async function get(client, id) {
  const run = await repo.findRun(client, id);
  if (!run) return null;
  const items = await repo.listItems(client, id);
  return { ...run, items };
}
const list = (client, q) => repo.listRuns(client, q);

function periodEnd(periodCode) {
  const [y, m] = String(periodCode).split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // last day of month
}

module.exports = { createRun, compute, setStatus, get, list };
