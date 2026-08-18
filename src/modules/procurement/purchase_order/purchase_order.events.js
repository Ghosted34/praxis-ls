"use strict";

const transition = (status) => "purchase_order." + String(status).toLowerCase();
// The unlock loop (10721) — mirror of costing's UNLOCK_EVENT (10718).
const UNLOCK_EVENT = {
  REQUEST_UNLOCK: "purchase_order.unlock_requested",
  UNLOCK: "purchase_order.unlocked",
  DENY_UNLOCK: "purchase_order.unlock_denied",
};
const unlockEvent = (action) => UNLOCK_EVENT[action] || transition("unlock");
module.exports = {
  MODULE: "MOD-60",
  CREATED: "purchase_order.created",
  UPDATED: "purchase_order.updated",
  ARCHIVED: "purchase_order.archived",
  PAID: "purchase_order.paid",
  transition, UNLOCK_EVENT, unlockEvent,
};
