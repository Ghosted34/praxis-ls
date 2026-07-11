"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const repo = require("./work_order.repo");
const events = require("./work_order.events");

// Maintenance work-order lifecycle. Ledger posting (entry_id → COA) is deferred
// until Phase 1 journal posting lands; status transitions only for now.
const TRANSITIONS = {
  OPEN: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["DONE", "CANCELLED"],
  DONE: [],
  CANCELLED: [],
};

const base = makeService({ repo, moduleKey: events.MODULE, entity: "work_order", events });

module.exports = {
  ...base,
  async setStatus(client, { id, status, actor }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    const allowed = TRANSITIONS[before.status] || [];
    if (!allowed.includes(status)) {
      throw new AppError("INVALID_TRANSITION", `Cannot move work order ${before.status} → ${status}`, 422);
    }
    const patch = { status };
    if (status === "DONE") patch.closed_on = new Date();
    const row = await repo.update(client, id, patch);
    const entityRef = `work_order:${id}`;
    await emitEvent(client, { eventTypeKey: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef, before, after: row });
    return row;
  },
};
