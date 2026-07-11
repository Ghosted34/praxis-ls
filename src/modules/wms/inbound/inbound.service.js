"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const repo = require("./inbound.repo");
const events = require("./inbound.events");

// Goods-received QA gate. A GRN opens on HOLD; QA either PASSES (with a putaway
// location) or REJECTS. Once decided it is terminal.
const base = makeService({ repo, moduleKey: events.MODULE, entity: "inbound", events });

module.exports = {
  ...base,
  async setQa(client, { id, qa_status, putaway_location, actor }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    if (before.qa_status && before.qa_status !== "HOLD") {
      throw new AppError("INVALID_TRANSITION", `GRN already ${before.qa_status}`, 422);
    }
    const patch = { qa_status };
    if (qa_status === "PASSED" && putaway_location) patch.putaway_location = putaway_location;
    const row = await repo.update(client, id, patch);
    const entityRef = `inbound:${id}`;
    await emitEvent(client, { eventTypeKey: events.QA_CHANGED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.QA_CHANGED, moduleKey: events.MODULE, entityRef, before, after: row });
    return row;
  },
};
