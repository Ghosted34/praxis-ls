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

module.exports = { create, update, setActive, remove, get, list, roster, drivers, references, assertActive };
