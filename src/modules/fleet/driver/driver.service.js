/**
 * Driver licence (MOD-44). Licences bound to an employee, guarded so a licence is
 * only issued to an active employee (wires HR ↔ fleet). The `scanExpiring`
 * routine emits `driver.license.expiring` for licences lapsing within N days —
 * critical for compliance since an expired licence grounds a driver. Method
 * surface matches the shared controller.
 */
"use strict";
const repo = require("./driver.repo");
const events = require("./driver.events");
const { alertLevel } = require("./driver.rules");
const employeeService = require("../../master/employees/employees.service");
const { emitEvent, audit } = require("../../../shared/events/emit");

const ref = (id) => "driver_license:" + id;

module.exports = {
  __entityMeta: { entity: "driver", table: "driver_license", pk: "driver_license_id", activeColumn: null },

  async list(client, q) {
    const rows = await repo.list(client, q);
    return rows.map((r) => ({ ...r, alert_level: alertLevel(r.days_left ?? null) }));
  },
  get: (client, id) => repo.findById(client, id),

  async create(client, { data, actor = {} }) {
    await employeeService.assertActive(client, data.employee_id);
    const row = await repo.insert(client, data);
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.driver_license_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.driver_license_id), after: row });
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
    return { archived: true, driver_license_id: id };
  },

  async expiring(client, { days = 30 } = {}) {
    const rows = await repo.expiringWithin(client, days);
    return rows.map((r) => ({ ...r, alert_level: alertLevel(r.days_left) }));
  },

  async scanExpiring(client, { days = 30, actor = {} } = {}) {
    const due = await repo.expiringWithin(client, days);
    for (const rec of due) {
      await emitEvent(client, {
        eventTypeKey: events.LICENSE_EXPIRING, moduleKey: events.MODULE,
        entityRef: "employee:" + rec.employee_id, actorUserId: actor.user_id || null,
        payload: { driver_license_id: rec.driver_license_id, driver_name: rec.driver_name, license_class: rec.license_class, expires_on: rec.expires_on, days_left: rec.days_left },
      });
    }
    return { scanned: due.length, alerts_fired: due.length, window_days: days };
  },
};
