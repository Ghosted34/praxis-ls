/**
 * Cycle count (MOD-38). Records a stock audit against a location, stamps who
 * counted, summarises the discrepancy, and — when any line is off — emits
 * `cycle_count.discrepancy_found` so inventory reconciliation (MOD-35) can react.
 * Method surface matches the shared controller.
 */
"use strict";
const repo = require("./cycle_count.repo");
const events = require("./cycle_count.events");
const { summariseDiscrepancy } = require("./cycle_count.rules");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");

const ref = (id) => "cycle_count:" + id;

module.exports = {
  __entityMeta: { entity: "cycle_count", table: "cycle_count", pk: "cycle_count_id", activeColumn: null },

  async list(client, q) {
    const rows = await repo.list(client, q);
    return rows.map((r) => ({ ...r, discrepancy_summary: summariseDiscrepancy(r.discrepancy) }));
  },
  async get(client, id) {
    const row = await repo.findById(client, id);
    return row ? { ...row, discrepancy_summary: summariseDiscrepancy(row.discrepancy) } : null;
  },

  async create(client, { data, actor = {} }) {
    const payload = { ...data };
    // DATA 2.4: counted_by is REFERENCES app_user(user_id). Identity is pinned
    // to the LIVE schema while this write goes to whichever schema the request
    // selected, so a valid live user id raises 23503 beside sandbox data. Same
    // guard emit.js applies to its own actor columns.
    if (actor.user_id && !payload.counted_by) {
      payload.counted_by = await resolveActorId(client, actor.user_id);
    }
    // discrepancy is a jsonb column: an array/object must be sent as JSON text,
    // otherwise node-pg serialises a JS array as a Postgres array literal ("{…}")
    // and the jsonb cast fails (22P02). summariseDiscrepancy reads it back fine.
    if (payload.discrepancy !== null && payload.discrepancy !== undefined && typeof payload.discrepancy !== "string") {
      payload.discrepancy = JSON.stringify(payload.discrepancy);
    }
    const row = await repo.insert(client, payload);
    const summary = summariseDiscrepancy(row.discrepancy);
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.cycle_count_id), actorUserId: actor.user_id || null });
    if (summary.has_discrepancy) {
      await emitEvent(client, {
        eventTypeKey: events.DISCREPANCY_FOUND, moduleKey: events.MODULE,
        entityRef: "warehouse_location:" + row.location_id, actorUserId: actor.user_id || null,
        payload: { cycle_count_id: row.cycle_count_id, ...summary },
      });
    }
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.cycle_count_id), after: row });
    return { ...row, discrepancy_summary: summary };
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
    return { archived: true, cycle_count_id: id };
  },
};
