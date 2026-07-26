/**
 * Appraisal (MOD-13). Rates an employee against a KPI target. On create, if a
 * kpi_target is linked and no explicit rating is supplied, the rating is computed
 * from attainment (actual ÷ target, 0–5). Guards that the employee is active.
 * Method surface matches the shared controller.
 */
"use strict";
const repo = require("./appraisal.repo");
const earningRepo = require("../payroll/earning.repo");
const events = require("./appraisal.events");
const { computeRating, weightedScore } = require("./appraisal.rules");
const employeeService = require("../../master/employees/employees.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "appraisal:" + id;

module.exports = {
  __entityMeta: { entity: "appraisal", table: "appraisal", pk: "appraisal_id", activeColumn: null },

  async list(client, q) {
    const rows = await repo.list(client, q);
    const rewards = await earningRepo.bySourceRefs(client, rows.map((r) => ref(r.appraisal_id)));
    return rows.map((r) => {
      const rw = rewards[ref(r.appraisal_id)];
      return { ...r, weighted_score: weightedScore(r.rating, r.weight), reward_amount: rw ? Number(rw.amount) : null, reward_status: rw ? rw.status : null };
    });
  },
  get: (client, id) => repo.findById(client, id),

  /**
   * Recommend a performance reward — creates/updates a PENDING employee_earning
   * (a bonus) tied to this appraisal. Payroll adds it to gross next run; once a
   * validated run pays it, it locks (409 on further changes).
   */
  async recommendReward(client, { id, amount, label = null, actor = {} }) {
    const a = await repo.findById(client, id);
    if (!a) throw new AppError("NOT_FOUND", "Appraisal not found", 404);
    if (!(Number(amount) >= 0)) throw new AppError("BAD_AMOUNT", "amount must be a non-negative number", 422);
    const emp = await client.query("SELECT entity_id FROM employee WHERE employee_id = $1", [a.employee_id]);
    const entityId = emp.rows[0] ? emp.rows[0].entity_id : null;
    const earning = await earningRepo.upsertFromSource(client, {
      employee_id: a.employee_id, entity_id: entityId, period_code: a.period_code,
      kind: "BONUS", label: label || `Appraisal reward · ${a.period_code}`, amount: Number(amount),
      source_ref: ref(id), created_by: actor.user_id || null,
    });
    if (!earning) throw new AppError("REWARD_LOCKED", "This reward was already paid in a validated payroll run and can't be changed", 409);
    await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: "appraisal.reward", moduleKey: events.MODULE, entityRef: ref(id), after: earning });
    return earning;
  },

  async create(client, { data, actor = {} }) {
    if (data.employee_id) await employeeService.assertActive(client, data.employee_id);
    const payload = { ...data };
    // Auto-score from the KPI target when a rating isn't provided.
    if ((payload.rating === undefined || payload.rating === null) && payload.kpi_target_id && payload.actual_value !== undefined) {
      const target = await repo.getTarget(client, payload.kpi_target_id);
      if (target) {
        const computed = computeRating(payload.actual_value, target.target_value);
        if (computed !== null) payload.rating = computed;
      }
    }
    if (actor.user_id) payload.rated_by = actor.user_id;
    const row = await repo.insert(client, payload);
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.appraisal_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.appraisal_id), after: row });
    return row;
  },

  async update(client, { id, patch, actor = {} }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    const row = await repo.update(client, id, patch);
    await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
    return row;
  },

  async archive(client, { id, actor = {} }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    await client.query("INSERT INTO soft_delete (entity_ref, payload_json, deleted_by) VALUES ($1,$2,$3)", [ref(id), before, actor.user_id || null]);
    await emitEvent(client, { eventTypeKey: events.ARCHIVED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.ARCHIVED, moduleKey: events.MODULE, entityRef: ref(id), before });
    return { archived: true, appraisal_id: id };
  },
};
