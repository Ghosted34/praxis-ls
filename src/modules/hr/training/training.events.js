"use strict";
module.exports = {
  MODULE: "MOD-18",
  CREATED: "training.created",
  UPDATED: "training.updated",
  ARCHIVED: "training.archived",
  STATUS_CHANGED: "training.status_changed",
  ATTENDEE_ADDED: "training.attendee_added",
  ATTENDEE_UPDATED: "training.attendee_updated",
  // 0702 — the live session. Joining and leaving are audit-only: they happen
  // dozens of times per session and emitting a domain event for each would
  // drown every other HR notification in the room's connection quality.
  ATTENDEE_JOINED: "training.attendee_joined",
  ATTENDEE_LEFT: "training.attendee_left",
  ATTENDANCE_SETTLED: "training.attendance_settled",
  MINUTES_FILED: "training.minutes_filed",
  // 10708 — live dictation. Audit-only like join/leave: a chunk lands every
  // ~30 seconds through a whole session, and an event per chunk would drown
  // every other HR notification in the room's microphone activity.
  DICTATION_APPENDED: "training.dictation_appended",
  REQUIREMENT_CHANGED: "training.requirement_changed",
};
