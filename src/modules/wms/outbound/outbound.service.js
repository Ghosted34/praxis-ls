"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const repo = require("./outbound.repo");
const events = require("./outbound.events");

// Outbound pick/pack/dispatch flow. Order lifecycle drives line handling;
// DISPATCHED stamps dispatched_at. Stock decrement on dispatch is handled by the
// inventory module's move journal (kept decoupled here).
const TRANSITIONS = {
  CREATED: ["PICKING", "CANCELLED"],
  PICKING: ["PACKED", "CANCELLED"],
  PACKED: ["DISPATCHED", "CANCELLED"],
  DISPATCHED: [],
  CANCELLED: [],
};

const base = makeService({ repo, moduleKey: events.MODULE, entity: "outbound", events });

module.exports = {
  ...base,
  listLines: (client, orderId) => repo.listLines(client, orderId),

  async setStatus(client, { id, status, actor }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    const allowed = TRANSITIONS[before.status] || [];
    if (!allowed.includes(status)) {
      throw new AppError("INVALID_TRANSITION", `Cannot move outbound order ${before.status} → ${status}`, 422);
    }
    const patch = { status };
    if (status === "DISPATCHED") patch.dispatched_at = new Date();
    const row = await repo.update(client, id, patch);
    const entityRef = `outbound:${id}`;
    await emitEvent(client, { eventTypeKey: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef, before, after: row });
    return row;
  },

  async addLine(client, { orderId, data, actor }) {
    const order = await repo.findById(client, orderId);
    if (!order) return null;
    if (!["CREATED", "PICKING"].includes(order.status)) {
      throw new AppError("ORDER_LOCKED", `Cannot add lines to a ${order.status} order`, 422);
    }
    const line = await repo.insertLine(client, { ...data, outbound_order_id: orderId });
    const entityRef = `outbound:${orderId}`;
    await emitEvent(client, { eventTypeKey: events.LINE_ADDED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.LINE_ADDED, moduleKey: events.MODULE, entityRef, after: line });
    return line;
  },

  async setLineFlags(client, { orderId, lineId, picked, packed, actor }) {
    const line = await repo.getLine(client, lineId);
    if (!line || line.outbound_order_id !== orderId) return null;
    const patch = {};
    if (picked !== undefined) patch.picked = picked;
    if (packed !== undefined) patch.packed = packed;
    if (Object.keys(patch).length === 0) return line;
    const updated = await repo.updateLine(client, lineId, patch);
    const entityRef = `outbound:${orderId}`;
    await emitEvent(client, { eventTypeKey: events.LINE_UPDATED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.LINE_UPDATED, moduleKey: events.MODULE, entityRef, before: line, after: updated });
    return updated;
  },
};
