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
  // Header + optional received-lines. `lines` isn't a grn_inbound column, so it's
  // split off before the header insert, then written to grn_line.
  async create(client, { data, actor }) {
    const { lines, ...header } = data || {};
    const row = await base.create(client, { data: header, actor });
    for (const l of lines || []) {
      if (!l || !l.item) continue;
      await repo.insertLine(client, { grn_inbound_id: row.grn_inbound_id, item: l.item, ordered: Number(l.ordered) || 0, received: Number(l.received) || 0, condition: l.condition || null });
    }
    return row;
  },
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
