"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const repo = require("./equipment.repo");
const events = require("./equipment.events");

// Handling equipment (forklifts, reach-stackers). Status is free among the four
// operational states except a disposed/out-of-service unit needs an explicit
// return to AVAILABLE before reuse.
const TRANSITIONS = {
  AVAILABLE: ["IN_USE", "MAINTENANCE", "OUT_OF_SERVICE"],
  IN_USE: ["AVAILABLE", "MAINTENANCE", "OUT_OF_SERVICE"],
  MAINTENANCE: ["AVAILABLE", "OUT_OF_SERVICE"],
  OUT_OF_SERVICE: ["AVAILABLE"],
};

const base = makeService({ repo, moduleKey: events.MODULE, entity: "equipment", events });

module.exports = {
  ...base,
  async setStatus(client, { id, status, assigned_to, actor }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    const allowed = TRANSITIONS[before.status] || [];
    if (!allowed.includes(status)) {
      throw new AppError("INVALID_TRANSITION", `Cannot move equipment ${before.status} → ${status}`, 422);
    }
    const patch = { status };
    if (status === "IN_USE") patch.assigned_to = assigned_to ?? before.assigned_to;
    if (status === "AVAILABLE") patch.assigned_to = null;
    const row = await repo.update(client, id, patch);
    const entityRef = `equipment:${id}`;
    await emitEvent(client, { eventTypeKey: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef, before, after: row });
    return row;
  },
};
