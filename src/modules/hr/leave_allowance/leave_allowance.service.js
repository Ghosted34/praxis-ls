"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const repo = require("./leave_allowance.repo");
const events = require("./leave_allowance.events");
const employeeService = require("../../master/employees/employees.service");

// Leave / salary-advance / mission requests. A request is decided once from
// REQUESTED. Salary-advance ledger posting (amount → 4211) is deferred to the
// Phase 1 posting engine; here we only record the HR decision.
const base = makeService({ repo, moduleKey: events.MODULE, entity: "leave_allowance", events });

module.exports = {
  ...base,

  // A request is always bound to an active employee (HR integrity).
  async create(client, { data, actor = {} }) {
    if (data.employee_id) await employeeService.assertActive(client, data.employee_id);
    return base.create(client, { data, actor });
  },

  async decide(client, { id, status, actor }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    if (before.status !== "REQUESTED") {
      throw new AppError("INVALID_TRANSITION", `Request already ${before.status}`, 422);
    }
    const row = await repo.update(client, id, { status });
    const entityRef = `leave_allowance:${id}`;
    await emitEvent(client, { eventTypeKey: events.DECIDED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.DECIDED, moduleKey: events.MODULE, entityRef, before, after: row });
    return row;
  },
};
