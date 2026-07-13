"use strict";
// Reporting & Insights (MOD-63). Read-first module; writes are saved reports +
// dashboard-tile layout. Event keys declared here for the emit/audit trail.
module.exports = {
  MODULE: "MOD-63",
  REPORT_SAVED: "report.saved",
  REPORT_DELETED: "report.deleted",
  TILE_SET: "dashboard.tile.set",
  // Scheduled reports (1.3). Audited to immutable_ledger only (free-text action);
  // not emitted to event_log to avoid depending on unseeded event_type keys.
  SCHEDULE_SET: "report.schedule.set",
  SCHEDULE_DELETED: "report.schedule.deleted",
  SCHEDULE_RAN: "report.schedule.ran",
};
