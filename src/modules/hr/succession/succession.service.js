/**
 * Succession plan (MOD-19). Names a role's incumbent and groomed successor with
 * a readiness horizon; the talent pool feeds candidate names. Method surface
 * matches the shared controller (list/get/create/update/archive).
 */
"use strict";
const repo = require("./succession.repo");
const events = require("./succession.events");
const { emitEvent, audit } = require("../../../shared/events/emit");

const ref = (id) => "succession_plan:" + id;

module.exports = {
  __entityMeta: { entity: "succession_plan", table: "succession_plan", pk: "succession_plan_id", activeColumn: null },

  list: (client, q) => repo.list(client, q),
  get: (client, id) => repo.findById(client, id),

  async create(client, { data, actor = {} }) {
    const row = await repo.insert(client, data);
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.succession_plan_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.succession_plan_id), after: row });
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
    return { archived: true, succession_plan_id: id };
  },
};
