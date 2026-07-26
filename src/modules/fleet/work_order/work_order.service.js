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

  listParts: (client, { id }) => repo.listParts(client, id),

  // Add a part line and roll the work-order cost up to the sum of its parts, so
  // the maintenance cost stays a true reflection of consumed labour/spares.
  async addPart(client, { id, data, actor }) {
    const wo = await repo.findById(client, id);
    if (!wo) return null;
    if (wo.status === "DONE" || wo.status === "CANCELLED") {
      throw new AppError("INVALID_STATE", `Cannot add parts to a ${wo.status} work order`, 422);
    }
    await repo.addPart(client, { work_order_id: id, ...data });
    const parts = await repo.listParts(client, id);
    const cost = parts.reduce((s, p) => s + Number(p.qty) * Number(p.unit_cost), 0);
    const row = await repo.update(client, id, { cost });
    const entityRef = `work_order:${id}`;
    await audit(client, { actorUserId: actor.user_id, action: "part_added", moduleKey: events.MODULE, entityRef, before: wo, after: row });
    return { ...row, parts };
  },
};
