/**
 * Vehicle registry (MOD-39) — the fleet's asset spine. Real lifecycle over the
 * `vehicle` table with a status ladder (ACTIVE ⇄ INACTIVE → DISPOSED) and a
 * disposal guard: a vehicle still out on dispatch or with open work orders can't
 * be disposed. Exposes `assertAvailable` for dispatch to consume.
 * Method surface (list/get/create/update/archive) matches the shared controller.
 */
"use strict";
const repo = require("./vehicle.repo");
const events = require("./vehicle.events");
const { canTransition } = require("./vehicle.rules");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "vehicle:" + id;

module.exports = {
  __entityMeta: { entity: "vehicle", table: "vehicle", pk: "vehicle_id", activeColumn: null },

  list: (client, q) => repo.list(client, q),
  get: (client, id) => repo.get(client, id),

  async create(client, { data, actor = {} }) {
    const row = await repo.insert(client, { ...data, status: data.status || "ACTIVE" });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.vehicle_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.vehicle_id), after: row });
    return row;
  },

  async update(client, { id, patch, actor = {} }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    // Status change goes through the transition guard.
    const isStatusChange = patch.status && patch.status !== before.status;
    if (isStatusChange) {
      if (!canTransition(before.status, patch.status)) {
        throw new AppError("INVALID_TRANSITION", `Cannot move vehicle ${before.status} → ${patch.status}`, 422);
      }
      if (patch.status === "DISPOSED") {
        const open = await repo.openCommitments(client, id);
        if (open.total > 0) {
          throw new AppError("VEHICLE_COMMITTED", `Cannot dispose: ${open.dispatch} active dispatch(es), ${open.workOrders} open work order(s)`, 422);
        }
      }
    }
    const row = await repo.update(client, id, patch);
    // A status transition emits a dedicated event (consistent with work_order /
    // equipment); other edits emit the generic UPDATED.
    const eventTypeKey = isStatusChange ? events.STATUS_CHANGED : events.UPDATED;
    await emitEvent(client, { eventTypeKey, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null, payload: isStatusChange ? { from: before.status, to: patch.status } : undefined });
    await audit(client, { actorUserId: actor.user_id || null, action: eventTypeKey, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
    return row;
  },

  async archive(client, { id, actor = {} }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    await client.query(
      "INSERT INTO soft_delete (entity_ref, payload_json, deleted_by) VALUES ($1,$2,$3)",
      [ref(id), before, actor.user_id || null],
    );
    await emitEvent(client, { eventTypeKey: events.ARCHIVED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.ARCHIVED, moduleKey: events.MODULE, entityRef: ref(id), before });
    return { archived: true, vehicle_id: id };
  },

  /** Integration guard for fleet dispatch: vehicle must exist and be ACTIVE. */
  async assertAvailable(client, id) {
    const v = await repo.findById(client, id);
    if (!v) throw new AppError("VEHICLE_NOT_FOUND", "Vehicle not found", 404);
    if (v.status !== "ACTIVE") throw new AppError("VEHICLE_UNAVAILABLE", `Vehicle is ${v.status}`, 422);
    return v;
  },
};
