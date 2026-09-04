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
module.exports = { MODULE: "MOD-46", CREATED: "costing.created", UPDATED: "costing.updated", APPROVED: "costing.approved", statusChange, UNLOCK_EVENT, unlockEvent };
