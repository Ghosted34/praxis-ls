"use strict";
// The Universal Event Engine's own admin surface (event-type registration +
// workflow/step design). MOD-67 gates it: per the permission-matrix conflict
// resolution (doc/WORK_DONE.md 2026-07-08, item B), "AI & event engine" shares
// MOD-67 with "IAM & user access" until the event engine earns its own
// module_key. These keys are descriptive audit/event-log labels (event_log has
// no FK on event_type_key, so unseeded keys are fine).
module.exports = {
  MODULE: "MOD-67",
  EVENT_TYPE_REGISTERED: "event_type.registered",
  WORKFLOW_CREATED: "workflow.created",
  WORKFLOW_UPDATED: "workflow.updated",
  WORKFLOW_ARCHIVED: "workflow.archived",
  STEP_ADDED: "workflow_step.added",
  STEP_REMOVED: "workflow_step.removed",
};
