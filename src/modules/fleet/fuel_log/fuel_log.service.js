/**
 * Fuel log (MOD-43). Records fuel fills against a vehicle, guards the odometer
 * from going backwards, tags spend to a dossier for cost attribution, and emits
 * `fuel.logged` so downstream cost/GL wiring can react (KB §8.7 — fuel posts to
 * 6053 tagged to dossier). Ledger posting is a guarded, gracefully-degrading
 * hook: it fires only once a fuel-expense account is configured in Settings,
 * otherwise the fill is recorded with entry_id left null (never a wrong entry).
 * Method surface matches the shared controller.
 */
"use strict";
const repo = require("./fuel_log.repo");
const events = require("./fuel_log.events");
const { odometerValid, efficiencyL100 } = require("./fuel_log.rules");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "fuel_log:" + id;

module.exports = {
  __entityMeta: { entity: "fuel_log", table: "fuel_log", pk: "fuel_log_id", activeColumn: null },

  list: (client, q) => repo.list(client, q),
  get: (client, id) => repo.findById(client, id),
  summary: (client, vehicleId) => repo.summary(client, vehicleId),

  async create(client, { data, actor = {} }) {
    const last = await repo.lastOdometer(client, data.vehicle_id);
    if (!odometerValid(data.odometer, last)) {
      throw new AppError("ODOMETER_BACKWARDS", `Odometer ${data.odometer} is below last recorded ${last}`, 422);
    }
    const row = await repo.insert(client, data);
    await emitEvent(client, {
      eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.fuel_log_id), actorUserId: actor.user_id || null,
      payload: { vehicle_id: row.vehicle_id, dossier_id: row.dossier_id, cost: row.cost },
    });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.fuel_log_id), after: row });
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
    return { archived: true, fuel_log_id: id };
  },

  /** Consumption stats for a vehicle (L/100km over recorded span). */
  async efficiency(client, vehicleId) {
    const s = await repo.summary(client, vehicleId);
    return { ...s, l_per_100km: efficiencyL100(s.total_litres, s.distance) };
  },
};
