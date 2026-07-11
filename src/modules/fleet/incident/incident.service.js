"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const repo = require("./incident.repo");
const events = require("./incident.events");
const employeeService = require("../../master/employees/employees.service");

// Fleet incident lifecycle. Insurance claims (fleet_claim) hang off a closed or
// under-review incident; claim handling is a separate concern (deferred).
const TRANSITIONS = {
  OPEN: ["UNDER_REVIEW", "CLOSED"],
  UNDER_REVIEW: ["CLOSED"],
  CLOSED: [],
};

const base = makeService({ repo, moduleKey: events.MODULE, entity: "incident", events });

module.exports = {
  ...base,

  // Logging an incident against a driver validates that the driver is a real,
  // active employee (fleet ↔ HR join). Vehicle is optional (an incident may be
  // reported before the vehicle is identified).
  async create(client, { data, actor = {} }) {
    if (data.driver_employee_id) await employeeService.assertActive(client, data.driver_employee_id);
    return base.create(client, { data, actor });
  },

  async setStatus(client, { id, status, actor }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    const allowed = TRANSITIONS[before.status] || [];
    if (!allowed.includes(status)) {
      throw new AppError("INVALID_TRANSITION", `Cannot move incident ${before.status} → ${status}`, 422);
    }
    const row = await repo.update(client, id, { status });
    const entityRef = `incident:${id}`;
    await emitEvent(client, { eventTypeKey: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef, before, after: row });
    return row;
  },
};
