/**
 * Employee master (MOD-02) — the HR/payroll/fleet foundation record
 * (PRD §MOD-02, KB §9). Full lifecycle over the `employee` registry: create,
 * edit, activate/deactivate, reference-guarded delete, plus the read shapes the
 * rest of Phase 3 consumes (roster, drivers) and `assertActive` — the guard
 * every referencing module (payroll lines, dispatch, contracts) calls before it
 * binds an employee. SQL lives in the repo; rules in employees.rules.
 */
"use strict";
const repo = require("./employees.repo");
const events = require("./employees.events");
const { suggestRiskClass, normaliseBankBlock } = require("./employees.rules");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "employee:" + id;

/**
 * A reporting line may not loop (0493). The DB rejects self-management with a
 * CHECK; A→B→A needs a walk, and expressing that declaratively would mean a
 * trigger firing on every employee write for a rule that only matters when
 * `reports_to` changes.
 *
 * The message names the manager, because "cycle detected" tells an HR clerk
 * nothing about which pick was wrong.
 */
async function assertNoReportingCycle(client, employeeId, managerId) {
  if (!managerId) return;
  if (managerId === employeeId) {
    throw new AppError("REPORTING_CYCLE", "Somebody can't report to themselves", 422);
  }
  if (await repo.wouldCycle(client, employeeId, managerId)) {
    const mgr = await repo.getBare(client, managerId);
    throw new AppError(
      "REPORTING_CYCLE",
      `${mgr && mgr.full_name ? mgr.full_name : "That person"} already reports to this employee, directly or through someone else — the line would loop`,
      422,
    );
  }
}

async function create(client, { data, actor = {} }) {
  await client.query("BEGIN");
  try {
    const bank_block = normaliseBankBlock(data.bank_block);
    const risk_class_rate =
      data.risk_class_rate !== undefined && data.risk_class_rate !== null
        ? data.risk_class_rate
        : suggestRiskClass(data);
    const row = await repo.insert(client, { ...data, bank_block, risk_class_rate });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.employee_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.employee_id), after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function update(client, { id, patch, actor = {} }) {
  const before = await repo.getBare(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Employee not found", 404);
  const fields = { ...patch };
  if (fields.bank_block !== undefined) fields.bank_block = normaliseBankBlock(fields.bank_block);
  // Only when the line actually changes — a no-op save shouldn't pay for a walk.
  if (fields.reports_to !== undefined && fields.reports_to !== before.reports_to) {
    await assertNoReportingCycle(client, id, fields.reports_to);
  }
  const row = await repo.update(client, id, fields);
  await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/** Activate / deactivate (soft state). Deactivation keeps history intact. */
async function setActive(client, { id, is_active, actor = {} }) {
  const before = await repo.getBare(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Employee not found", 404);
  if (before.is_active === is_active) return before; // idempotent
  const row = await repo.update(client, id, { is_active });
  const evt = is_active ? events.REACTIVATED : events.DEACTIVATED;
  await emitEvent(client, { eventTypeKey: evt, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: evt, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/**
 * Delete. An employee referenced anywhere (payroll, contracts, dispatch, a user
 * account…) is never hard-deleted — history must survive. In that case we
 * deactivate and report why; only an unreferenced record is physically removed.
 */
async function remove(client, { id, actor = {} }) {
  const before = await repo.getBare(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Employee not found", 404);
  const refs = await repo.countReferences(client, id);
  if (refs.total > 0) {
    const row = await setActive(client, { id, is_active: false, actor });
    return { deleted: false, deactivated: true, references: refs, employee: row };
  }
  await client.query("DELETE FROM employee WHERE employee_id = $1", [id]);
  await emitEvent(client, { eventTypeKey: events.ARCHIVED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.ARCHIVED, moduleKey: events.MODULE, entityRef: ref(id), before });
  return { deleted: true, deactivated: false, references: refs };
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);
const roster = (client, q = {}) => repo.roster(client, q);
const drivers = (client, q = {}) => repo.drivers(client, q);
const references = (client, id) => repo.countReferences(client, id);

/**
 * Integration guard for other modules: resolve an employee that must exist and
 * be active before it can be bound (payroll line, dispatch, contract). Throws a
 * 404/422 the caller can surface. This is the single end-to-end contract point.
 */
async function assertActive(client, id) {
  const e = await repo.getBare(client, id);
  if (!e) throw new AppError("EMPLOYEE_NOT_FOUND", "Employee not found", 404);
  if (!e.is_active) throw new AppError("EMPLOYEE_INACTIVE", "Employee is deactivated", 422);
  return e;
}

/* ── The reporting line (0493) ──────────────────────────────────────────────
 * `role.is_line_manager` is seeded as "approves for own team" and, until 0493,
 * nothing could resolve a team. These are what that needs — and what escalation
 * (audit W13) will read when it lands.
 */
const directReports = (client, id) => repo.directReports(client, id);
const team = (client, id, opts) => repo.teamOf(client, id, opts);
/** Nearest-first chain of managers above someone — the escalation path. */
const managerChain = (client, id) => repo.managerChain(client, id);

module.exports = {
  create, update, setActive, remove, get, list, roster, drivers, references, assertActive,
  directReports, team, managerChain, assertNoReportingCycle,
};
