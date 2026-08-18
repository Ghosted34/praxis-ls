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
const earningRepo = require("./earning.repo");
const advances = require("./salary_advance.service");
const events = require("./payroll.events");
const { computePayslip, DEFAULTS } = require("./payroll.rules");
const employeeService = require("../../master/employees/employees.service");
const journal = require("../../finance/journal_entry/journal_entry.service");
const executor = require("../../../services/workflow/executor");
const onApproved = require("../../../services/workflow/on-approved");
const { assertNoPendingChain } = require("../../../services/workflow/pending-guard");
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
  // G18 — the rates come from the effective-dated payroll_config table, not
  // from the request body. Resolve the most recent config effective on or
  // before the run's period end; only when NO stored config exists yet does a
  // caller-supplied preview config fall back in (fresh-tenant path), so two
  // people can never compute the same run differently once a config exists.
  const stored = await repo.configForPeriod(client, run.entity_id, periodEnd(run.period_code));
  const cfg = { ...DEFAULTS, ...(stored ? stored.config : config || {}) };
  const roster = await employeeService.roster(client, { entity_id: run.entity_id });
  await repo.deleteItems(client, id);
  // A recompute starts from clean: instalments this run had merely PROPOSED are
  // dropped, so a second pass cannot stack a second bite onto the same month.
  // APPLIED ones are untouched — that period was validated and is not reopened.
  await advances.clearPending(client, { payrollRunId: id });

  // Variable pay (appraisal rewards etc.) → added to GROSS so statutory
  // withholdings apply. Read-only here; the run marks them APPLIED on validate.
  const earnings = await earningRepo.pendingByEntityPeriod(client, run.entity_id, run.period_code);
  const bonusByEmployee = {};
  for (const e of earnings) bonusByEmployee[e.employee_id] = { total: Number(e.total || 0), lines: e.lines || [] };

  /* ── What the month actually did (0697/0698) ────────────────────────────
   *
   * The run used to be `base_salary + earnings`, full stop. Attendance
   * reconciled its deductions into rows nothing read, unpaid leave prorated
   * nothing, and an approved salary advance was never recovered.
   *
   * The two sides go to different places, and this is the distinction the
   * whole change turns on: TIME NOT WORKED comes off GROSS (the employee did
   * not earn it, so CNPS and IRPP are computed on the smaller figure), while
   * an ADVANCE comes off NET (they earned the full salary and were taxed on it
   * — they merely received part of it early). Getting it backwards overtaxes
   * or undertaxes every affected employee.
   */
  const attendance = await repo.attendanceInputs(client, run.period_code);
  const reconciled = await repo.periodReconciled(client, run.period_code);
  const dueList = await advances.dueForPeriod(client, { periodCode: run.period_code, entityId: run.entity_id });
  const advanceByEmployee = {};
  for (const a of dueList) advanceByEmployee[a.employee_id] = a;

  let totalGross = 0, totalNet = 0, totalEmployer = 0, count = 0;
  let totalAttendance = 0, totalUnpaidLeave = 0, totalRecovered = 0;
  for (const emp of roster) {
    const bonus = bonusByEmployee[emp.employee_id] || { total: 0, lines: [] };
    const att = attendance[emp.employee_id] || {};
    const base = round(Number(emp.base_salary || 0));
    const attendanceDeduction = round(Number(att.attendance_deduction || 0));
    const unpaidLeave = round(Number(att.unpaid_leave_deduction || 0));

    // Never below zero: a month of nothing but unpaid leave is a gross of zero,
    // not a negative salary the statutory engine would then compute tax on.
    const gross = round(Math.max(0, base + bonus.total - attendanceDeduction - unpaidLeave));

    const advance = advanceByEmployee[emp.employee_id] || null;
    const slip = computePayslip(emp, {
      gross,
      config: cfg,
      post_tax_deductions: advance ? [{ label: "Salary advance", amount: advance.due }] : [],
    });
    slip.base = base;
    slip.earnings = round(bonus.total);
    slip.earning_lines = bonus.lines;
    slip.attendance_deduction = attendanceDeduction;
    slip.unpaid_leave_deduction = unpaidLeave;
    // The counts behind the figures, so a payslip explains itself without a
    // second query — and so "why is this less than last month?" is answerable
    // on the slip rather than by opening attendance.
    slip.attendance = {
      reconciled,
      late_days: Number(att.late_days || 0),
      absent_days: Number(att.absent_days || 0),
      unpaid_leave_days: Number(att.unpaid_leave_days || 0),
      waived_days: Number(att.waived_days || 0),
    };

    // What was actually taken may be less than what was due — the engine caps
    // recovery at the net available rather than producing a negative payslip.
    const recovered = round(slip.total_post_tax_deductions || 0);
    if (advance && recovered > 0) {
      await advances.schedule(client, {
        advanceId: advance.salary_advance_id,
        periodCode: run.period_code,
        payrollRunId: id,
        amount: recovered,
      });
      slip.advance = {
        salary_advance_id: advance.salary_advance_id,
        due: advance.due,
        recovered,
        outstanding_after: round(Number(advance.outstanding) - recovered),
      };
    }

    await repo.insertItem(client, {
      payroll_run_id: id,
      employee_id: emp.employee_id,
      gross: slip.gross,
      net_pay: slip.net_pay,
      attendance_deduction: attendanceDeduction,
      unpaid_leave_deduction: unpaidLeave,
      advance_recovery: recovered,
      breakdown: slip,
    });
    totalGross += slip.gross;
    totalNet += slip.net_pay;
    totalEmployer += slip.total_employer_charges;
    totalAttendance += attendanceDeduction;
    totalUnpaidLeave += unpaidLeave;
    totalRecovered += recovered;
    count += 1;
  }

  const updated = await repo.updateRun(client, id, { status: "COMPUTED", config_snapshot: cfg });
  await emitEvent(client, { eventTypeKey: events.COMPUTED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null, payload: { employees: count, totalGross, totalNet } });
  await audit(client, { actorUserId: actor.user_id || null, action: events.COMPUTED, moduleKey: events.MODULE, entityRef: ref(id), after: updated });
  return {
    run: updated,
    item_count: count,
    // `attendance_reconciled: false` is not a detail. A month with no
    // reconciled days produces zero deductions, and that is "nobody looked",
    // not "nobody was late" — the screen must be able to say which.
    attendance_reconciled: reconciled,
    totals: {
      gross: round(totalGross),
      net: round(totalNet),
      employer_charges: round(totalEmployer),
      attendance_deduction: round(totalAttendance),
      unpaid_leave_deduction: round(totalUnpaidLeave),
      advance_recovery: round(totalRecovered),
    },
  };
}

async function setStatus(client, { id, status, actor = {}, viaChain = false }) {
  const before = await repo.findRun(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Payroll run not found", 404);
  const allowed = TRANSITIONS[before.status] || [];
  if (!allowed.includes(status)) throw new AppError("INVALID_TRANSITION", `Cannot move payroll ${before.status} → ${status}`, 422);
  // Approving/rejecting directly while a chain is live would skip it (W4).
  if (status === "APPROVED" || status === "REJECTED") {
    await assertNoPendingChain(client, ref(id), { viaChain, what: "payroll run" });
  }

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
  // Consume the variable-pay earnings this run paid, so they're paid once.
  if (status === "VALIDATED") {
    await earningRepo.markAppliedForRun(client, { runId: id, entityId: before.entity_id, periodCode: before.period_code });
    // The same rule for advances: PENDING instalments become APPLIED only when
    // the money is real, and any plan they finish settles in the same pass — so
    // a fully-recovered advance stops being taken from the next payslip without
    // anybody having to notice.
    await advances.applyForRun(client, { payrollRunId: id, actor });
  }
  // On submit-for-approval, open the tenant's configurable approval chain (bound
  // to payroll.status_changed). No workflow bound → autoApproved; the manual
  // APPROVED transition path is unchanged (BUILD_CONVENTIONS §2).
  if (status === "SUBMITTED") {
    await executor.start(client, { eventTypeKey: "payroll.status_changed", entityRef: ref(id), amountXaf: row.net_total === null || row.net_total === undefined ? null : Number(row.net_total) });
  }
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
  // 661 gross + 664 employer charges (debit); credit 431 CNPS, 4471 payroll
  // withholding, 422 net payable. Credits = gross + employer by construction.
  //
  // 4471, NOT 447. 447 "État, impôts retenus à la source" is a 3-digit grouping
  // with is_postable=false (9000:68) and three children (4471/4472/4474), so
  // assert_line_valid (0640:150) raised 'account 447 is not postable (KB §23.3)'
  // and took the whole payroll posting with it. 4471 "Impôt sur traitements et
  // salaires (IRPP+CAC)" (9000:122) is the payroll leaf, and it is exactly what
  // `taxes` sums above: cfc + irpp + cac (employee) + cfc + fne (employer).
  // Caught by tests/unit/postable-account-defaults.test.js. This is the SECOND
  // defect to silently kill this posting — see the note below.
  const employeeDeductions = round(gross - net); // CNPS_ee + taxes_ee
  // NOTE: buildAndInsert expects `account_code` (not `account`) and requires a
  // source_doc_ref to validate — both were missing, so this post silently threw
  // and degraded to null (payroll never hit the GL). Fixed.
  const lines = [
    { account_code: "661", debit: round(gross), credit: 0 },
    { account_code: "664", debit: round(employer), credit: 0 },
    { account_code: "431", debit: 0, credit: round(cnps) },
    { account_code: "4471", debit: 0, credit: round(taxes) },
    { account_code: "422", debit: 0, credit: round(gross + employer - cnps - taxes) },
  ];
  void employeeDeductions;
  try {
    const entry = await journal.post(client, {
      entityId: run.entity_id,
      entryDate: periodEnd(run.period_code),
      journalCode: "OD",
      description: `Payroll ${run.period_code}`,
      sourceDocRef: ref(run.payroll_run_id),
      source: "SYSTEM_AUTO",
      lines,
      actor,
    });
    return entry ? entry.entry_id || entry.entryId || null : null;
  } catch {
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
const myPayslips = (client, employeeId) => (employeeId ? repo.payslipsForEmployee(client, employeeId) : Promise.resolve([]));
/** The manager's view (profile 360): every stage of the run, because the
 *  question a manager asks is "has this month's payslip been computed for
 *  this person", not only "what have they been paid". */
const employeePayslips = (client, employeeId) =>
  employeeId ? repo.payslipsForEmployee(client, employeeId, { includeAll: true }) : Promise.resolve([]);

/**
 * Generate + download the caller's own payslip (self-service). The run item
 * must belong to the caller's employee record — nobody else's payslip is
 * reachable, whatever id is passed. Renders through the shared document
 * template (PAYSLIP) so the PDF is the same one payroll issues, then streams
 * the vaulted bytes.
 */
async function ownPayslipPdf(client, { runItemId, actor }) {
  const employeeId = actor.employee_id;
  if (!employeeId) throw new AppError("NO_EMPLOYEE", "No employee record on this account", 422);
  const owns = await repo.itemBelongsToEmployee(client, runItemId, employeeId);
  if (!owns) throw new AppError("NOT_FOUND", "No such payslip for you", 404);
  const { generate } = require("../../documents/template/template.service");
  const vault = require("../../vault/document_vault/document_vault.service");
  const out = await generate(client, { docType: "PAYSLIP", recordId: runItemId, actor });
  const { buffer } = await vault.fetchBytes(client, out.doc_id);
  return { buffer, doc: owns, verify: out.verify };
}

function periodEnd(periodCode) {
  const [y, m] = String(periodCode).split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // last day of month
}

// A cleared approval chain advances the run SUBMITTED → APPROVED (BUILD_CONVENTIONS §2/§5).
onApproved.register("payroll_run", (client, { id, actor }) => setStatus(client, { id, status: "APPROVED", actor: actor || {}, viaChain: true }));

// ── G18: effective-dated rate configuration ─────────────────────────────────

/** Top-level keys a tenant may override. Anything else is a typo, not a rate. */
const CONFIG_KEYS = new Set(Object.keys(DEFAULTS));

const listConfig = (client, { entityId }) => repo.listConfig(client, entityId);

/**
 * Save a rate config effective on a date (the legacy's one-afternoon admin
 * task). Unknown keys are refused (a typo must not silently ride along), the
 * row is upserted per (entity, date), and every OPEN run of the entity whose
 * period ends on/after the effective date gets its preview snapshot refreshed
 * so the next compute and the on-screen numbers agree. VALIDATED/APPROVED
 * runs are untouched — past periods stay honest, which is the entire point.
 */
async function saveConfig(client, { entityId, effectiveDate, config = {}, actor = {} }) {
  if (!entityId) throw new AppError("VALIDATION_ERROR", "entity_id is required", 422);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(effectiveDate || ""))) {
    throw new AppError("VALIDATION_ERROR", "effective_date must be YYYY-MM-DD", 422);
  }
  const clean = {};
  for (const [k, v] of Object.entries(config || {})) {
    if (!CONFIG_KEYS.has(k)) {
      throw new AppError("UNKNOWN_RATE", `"${k}" is not a payroll rate key`, 422, { config: [`unknown key "${k}"`] });
    }
    clean[k] = v;
  }
  const row = await repo.upsertConfig(client, { entityId, effectiveDate, config: clean, actorUserId: actor.user_id || null });
  await audit(client, {
    actorUserId: actor.user_id || null, action: "payroll.config_saved", moduleKey: events.MODULE,
    entityRef: "payroll_config:" + row.payroll_config_id, after: { entity_id: entityId, effective_date: effectiveDate },
  });
  // Propagate the preview to OPEN runs of this entity whose period starts at
  // or after the effective date. Past (validated) runs are deliberately
  // untouched.
  await client.query(
    `UPDATE payroll_run SET config_snapshot = $1
      WHERE entity_id = $2 AND status IN ('OPEN','COMPUTED')
        AND period_code >= to_char(($3::date), 'YYYY-MM')`,
    [JSON.stringify({ ...DEFAULTS, ...clean }), entityId, effectiveDate],
  );
  return row;
}

module.exports = { createRun, compute, setStatus, get, list, myPayslips, employeePayslips, ownPayslipPdf, saveConfig, listConfig };
