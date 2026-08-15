/**
 * Meeting (MOD-21) event keys.
 *
 * `dictation_failed` is emitted at HIGH priority by the service. That is
 * deliberate: a failed dictation is a piece of the client's own words that the
 * salesperson believes was captured and was not, and the longer it goes
 * unnoticed the less likely anyone can reconstruct it.
 */
"use strict";
module.exports = {
  MODULE: "MOD-21",
  CREATED: "meeting.created",
  UPDATED: "meeting.updated",
  NOTE_ADDED: "meeting.note_added",
  DISCOVERY_CAPTURED: "meeting.discovery_captured",
  DICTATION_QUEUED: "meeting.dictation_queued",
  DICTATION_TRANSCRIBED: "meeting.dictation_transcribed",
  DICTATION_FAILED: "meeting.dictation_failed",
  PROMPT_CHANGED: "meeting.discovery_prompt_changed",
};
