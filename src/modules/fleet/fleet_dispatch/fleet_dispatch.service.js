"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const repo = require("./fleet_dispatch.repo");
const events = require("./fleet_dispatch.events");
const vehicleService = require("../vehicle/vehicle.service");
const employeeService = require("../../master/employees/employees.service");

// Vehicle dispatch lifecycle. OUT stamps check-out (+ odometer); RETURNED stamps
// check-in (+ odometer). Fuel/odometer reconciliation stays in fuel_log.
const TRANSITIONS = {
  ASSIGNED: ["OUT", "CANCELLED"],
  OUT: ["RETURNED"],
  RETURNED: [],
  CANCELLED: [],
};

const base = makeService({ repo, moduleKey: events.MODULE, entity: "fleet_dispatch", events });

module.exports = {
  ...base,

  // Assigning a dispatch binds a live vehicle and (optionally) an active driver —
  // guard both up front so the fleet, vehicle registry and HR roster stay
  // consistent. This is the cross-module end-to-end join for MOD-42.
  async create(client, { data, actor = {} }) {
    await vehicleService.assertAvailable(client, data.vehicle_id);
    if (data.driver_employee_id) await employeeService.assertActive(client, data.driver_employee_id);
    return base.create(client, { data, actor });
  },

  async setStatus(client, { id, status, odometer, actor }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    const allowed = TRANSITIONS[before.status] || [];
    if (!allowed.includes(status)) {
      throw new AppError("INVALID_TRANSITION", `Cannot move dispatch ${before.status} → ${status}`, 422);
    }
    const patch = { status };
    if (status === "OUT") {
      patch.check_out_at = new Date();
      if (odometer !== null) patch.odometer_out = odometer;
    }
    if (status === "RETURNED") {
      patch.check_in_at = new Date();
      if (odometer !== null) patch.odometer_in = odometer;
    }
    const row = await repo.update(client, id, patch);
    const entityRef = `fleet_dispatch:${id}`;
    await emitEvent(client, { eventTypeKey: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef, before, after: row });
    return row;
  },
};
