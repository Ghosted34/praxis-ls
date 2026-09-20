"use strict";
// Smart Comms (MOD-64) — corporate WhatsApp-style messaging (PRD §11.5).
module.exports = {
  MODULE: "MOD-64",
  GROUP_CREATED: "comms.channel_created",
  MESSAGE_POSTED: "comms.message_posted",
  EXPORTED: "comms.certified_export",
  // 1:1 voice calls (PR-1). CALL_STARTED at dial, CALL_ENDED when the call
  // reaches ENDED, CALL_CLOSED for the other terminal states (NO_ANSWER,
  // CANCELLED, DECLINED, BUSY, FAILED) — closed, not ended, because no call
  // existed to end.
  CALL_STARTED: "comms.call_started",
  CALL_ENDED: "comms.call_ended",
  CALL_CLOSED: "comms.call_closed",
};
