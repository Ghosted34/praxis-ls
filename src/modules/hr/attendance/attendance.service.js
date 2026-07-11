"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const repo = require("./attendance.repo");
const events = require("./attendance.events");

const base = makeService({ repo, moduleKey: events.MODULE, entity: "attendance", events });

module.exports = {
  ...base,
  // Convenience: stamp clock-out on an open attendance row.
  async clockOut(client, { id, actor }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    if (before.clock_out_at) throw new AppError("ALREADY_CLOSED", "Attendance already clocked out", 422);
    const row = await repo.update(client, id, { clock_out_at: new Date() });
    const entityRef = `attendance:${id}`;
    await emitEvent(client, { eventTypeKey: events.CLOCKED_OUT, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.CLOCKED_OUT, moduleKey: events.MODULE, entityRef, before, after: row });
    return row;
  },
};
