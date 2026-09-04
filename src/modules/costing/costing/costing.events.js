"use strict";

const statusChange = (status) => "costing." + String(status).toLowerCase();
/** Unlock actions get their own event keys so a workflow chain can bind to the
 *  GRANT (costing.unlocked) without also firing on the request. */
const UNLOCK_EVENT = {
  REQUEST_UNLOCK: "costing.unlock_requested",
  UNLOCK: "costing.unlocked",
  DENY_UNLOCK: "costing.unlock_denied",
};
const unlockEvent = (action) => UNLOCK_EVENT[action] || statusChange(action);
// 12774 — a reminder sent to whoever is holding a pending sheet. Its own key
// rather than a status change, because nothing about the costing moved: this
// records that somebody was asked to look at it.
module.exports = { MODULE: "MOD-46", CREATED: "costing.created", UPDATED: "costing.updated", APPROVED: "costing.approved", NUDGED: "costing.nudged", statusChange, UNLOCK_EVENT, unlockEvent };
