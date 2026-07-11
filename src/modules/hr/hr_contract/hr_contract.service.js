"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const repo = require("./hr_contract.repo");
const events = require("./hr_contract.events");
const employeeService = require("../../master/employees/employees.service");

// Contract lifecycle: DRAFT → ISSUED → SIGNED → ENDED. A signed or ended
// contract is terminal for forward flow (ENDED only reachable from SIGNED).
const TRANSITIONS = {
  DRAFT: ["ISSUED"],
  ISSUED: ["SIGNED", "ENDED"],
  SIGNED: ["ENDED"],
  ENDED: [],
};

const base = makeService({ repo, moduleKey: events.MODULE, entity: "hr_contract", events });

module.exports = {
  ...base,

  // A contract is always issued to an active employee.
  async create(client, { data, actor = {} }) {
    if (data.employee_id) await employeeService.assertActive(client, data.employee_id);
    return base.create(client, { data, actor });
  },

  async setStatus(client, { id, status, actor }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    const allowed = TRANSITIONS[before.status] || [];
    if (!allowed.includes(status)) {
      throw new AppError("INVALID_TRANSITION", `Cannot move contract ${before.status} → ${status}`, 422);
    }
    const row = await repo.update(client, id, { status });
    const entityRef = `hr_contract:${id}`;
    await emitEvent(client, { eventTypeKey: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef, before, after: row });
    return row;
  },
};
