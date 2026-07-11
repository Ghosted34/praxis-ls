/**
 * Warehouse location (MOD-34). Slot registry with a composed label and an
 * occupancy-aware delete guard: a location holding stock, equipment or GRNs is
 * never removed (it would orphan placements) — it is soft-archived instead.
 * Method surface matches the shared controller.
 */
"use strict";
const repo = require("./warehouse_location.repo");
const events = require("./warehouse_location.events");
const { label } = require("./warehouse_location.rules");
const { emitEvent, audit } = require("../../../shared/events/emit");

const ref = (id) => "warehouse_location:" + id;
const withLabel = (r) => (r ? { ...r, label: label(r) } : r);

module.exports = {
  __entityMeta: { entity: "warehouse_location", table: "warehouse_location", pk: "location_id", activeColumn: null },

  async list(client, q) {
    const rows = await repo.list(client, q);
    return rows.map(withLabel);
  },
  async get(client, id) {
    const row = await repo.findById(client, id);
    if (!row) return null;
    const occ = await repo.occupancy(client, id);
    return { ...withLabel(row), occupancy: occ };
  },

  async create(client, { data, actor = {} }) {
    const row = await repo.insert(client, data);
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.location_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.location_id), after: row });
    return withLabel(row);
  },

  async update(client, { id, patch, actor = {} }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    const row = await repo.update(client, id, patch);
    await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
    return withLabel(row);
  },

  async archive(client, { id, actor = {} }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    const occ = await repo.occupancy(client, id);
    if (occ.total > 0) {
      return { archived: false, occupied: true, occupancy: occ };
    }
    await client.query("INSERT INTO soft_delete (entity_ref, payload_json, deleted_by) VALUES ($1,$2,$3)", [ref(id), before, actor.user_id || null]);
    await emitEvent(client, { eventTypeKey: events.ARCHIVED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.ARCHIVED, moduleKey: events.MODULE, entityRef: ref(id), before });
    return { archived: true, location_id: id };
  },
};
