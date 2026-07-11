"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const repo = require("./inventory.repo");
const events = require("./inventory.events");

// Stock state machine + movement journal. `move` applies a signed qty delta to
// qty_on_hand, optionally relocates the item, and appends a stock_movement row.
const STATE_TRANSITIONS = {
  AVAILABLE: ["QA_HOLD", "ALLOCATED", "DAMAGED"],
  QA_HOLD: ["AVAILABLE", "DAMAGED"],
  ALLOCATED: ["AVAILABLE", "DISPATCHED"],
  DISPATCHED: [],
  DAMAGED: ["AVAILABLE"],
};

const base = makeService({ repo, moduleKey: events.MODULE, entity: "inventory", events });

module.exports = {
  ...base,
  listMovements: (client, id) => repo.listMovements(client, id),

  async setState(client, { id, state, actor }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    const allowed = STATE_TRANSITIONS[before.state] || [];
    if (!allowed.includes(state)) {
      throw new AppError("INVALID_TRANSITION", `Cannot move stock ${before.state} → ${state}`, 422);
    }
    const row = await repo.update(client, id, { state, updated_at: new Date() });
    const entityRef = `inventory:${id}`;
    await emitEvent(client, { eventTypeKey: events.STATE_CHANGED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.STATE_CHANGED, moduleKey: events.MODULE, entityRef, before, after: row });
    return row;
  },

  async move(client, { id, movement_kind, qty, from_location, to_location, actor }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    const delta = Number(qty);
    const newQty = Number(before.qty_on_hand) + delta;
    if (newQty < 0) {
      throw new AppError("NEGATIVE_STOCK", `Move would drive qty below zero (${before.qty_on_hand} + ${delta})`, 422);
    }
    const patch = { qty_on_hand: newQty, updated_at: new Date() };
    if (to_location) patch.location_id = to_location;
    const row = await repo.update(client, id, patch);
    await repo.insertMovement(client, {
      inventory_item_id: id,
      movement_kind,
      qty: delta,
      from_location: from_location || before.location_id || null,
      to_location: to_location || null,
      moved_by: actor.user_id,
    });
    const entityRef = `inventory:${id}`;
    await emitEvent(client, { eventTypeKey: events.MOVED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.MOVED, moduleKey: events.MODULE, entityRef, before, after: row });
    return row;
  },
};
