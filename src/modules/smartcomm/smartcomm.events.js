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
  // PR-2 — the record half. Three things happen to a call after it ends, and
  // each one is an event because each one is something a person may need to
  // find later: the transcript was produced from the vaulted bytes,
  // transcription failed (the failure the ops alert rides on), and a draft
  // landed in the caller's hands / was sent by them.
  CALL_TRANSCRIBED: "comms.call_transcribed",
  CALL_TRANSCRIPTION_FAILED: "comms.call_transcription_failed",
  CALL_SUMMARY_DRAFTED: "comms.call_summary_drafted",
  CALL_SUMMARY_SENT: "comms.call_summary_sent",
  // PR-6 (audit G3): an admin erased one person's call records.
  CALL_RECORDS_ERASED: "comms.call_records_erased",
};
