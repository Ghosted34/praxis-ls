/**
 * Vehicle compliance (MOD-40) — insurance & visite-technique tracking with the
 * renewal-alert scan that is the module's real job. `scanExpiring` walks records
 * lapsing within N days and emits the seeded per-kind alert event
 * (vehicle.insurance.expiring / vehicle.visite_technique.expiring), which the
 * notification engine fans out. Method surface matches the shared controller.
 */
"use strict";
const repo = require("./vehicle_compliance.repo");
const events = require("./vehicle_compliance.events");
const { alertLevel } = require("./vehicle_compliance.rules");
const { emitEvent, audit } = require("../../../shared/events/emit");

const ref = (id) => "vehicle_compliance:" + id;

module.exports = {
  __entityMeta: { entity: "vehicle_compliance", table: "vehicle_compliance", pk: "compliance_id", activeColumn: null },

  async list(client, q) {
    const rows = await repo.list(client, q);
    return rows.map((r) => ({ ...r, alert_level: alertLevel(r.days_left ?? null) }));
  },
  get: (client, id) => repo.findById(client, id),

  async create(client, { data, actor = {} }) {
    const row = await repo.insert(client, data);
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.compliance_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.compliance_id), after: row });
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
    return { archived: true, compliance_id: id };
  },

  /** Read-only preview of what would alert (no events emitted). */
  async expiring(client, { days = 30 } = {}) {
    const rows = await repo.expiringWithin(client, days);
    return rows.map((r) => ({ ...r, alert_level: alertLevel(r.days_left) }));
  },

  /**
   * Fire renewal alerts for everything expiring within `days`. Idempotent-safe to
   * run on a schedule; emits one event per record keyed to its vehicle so the
   * notification fan-out reaches the fleet watchers. Returns the alert summary.
   */
  async scanExpiring(client, { days = 30, actor = {} } = {}) {
    const due = await repo.expiringWithin(client, days);
    let fired = 0;
    for (const rec of due) {
      const key = events.eventFor(rec.kind);
      if (!key) continue;
      await emitEvent(client, {
        eventTypeKey: key,
        moduleKey: events.MODULE,
        entityRef: "vehicle:" + rec.vehicle_id,
        actorUserId: actor.user_id || null,
        payload: { compliance_id: rec.compliance_id, registration: rec.registration, kind: rec.kind, expires_on: rec.expires_on, days_left: rec.days_left },
      });
      fired += 1;
    }
    return { scanned: due.length, alerts_fired: fired, window_days: days };
  },
};
