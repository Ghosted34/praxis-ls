/**
 * Appraisal (MOD-13). Rates an employee against a KPI target. On create, if a
 * kpi_target is linked and no explicit rating is supplied, the rating is computed
 * from attainment (actual ÷ target, 0–5). Guards that the employee is active.
 * Method surface matches the shared controller.
 */
"use strict";
const repo = require("./appraisal.repo");
const events = require("./appraisal.events");
const { computeRating, weightedScore } = require("./appraisal.rules");
const employeeService = require("../../master/employees/employees.service");
const { emitEvent, audit } = require("../../../shared/events/emit");

const ref = (id) => "appraisal:" + id;

module.exports = {
  __entityMeta: { entity: "appraisal", table: "appraisal", pk: "appraisal_id", activeColumn: null },

  async list(client, q) {
    const rows = await repo.list(client, q);
    return rows.map((r) => ({ ...r, weighted_score: weightedScore(r.rating, r.weight) }));
  },
  get: (client, id) => repo.findById(client, id),

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
