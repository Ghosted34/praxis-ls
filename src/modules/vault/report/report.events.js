"use strict";
// Reporting & Insights (MOD-63). Read-first module; writes are saved reports +
// dashboard-tile layout. Event keys declared here for the emit/audit trail.
module.exports = {
  MODULE: "MOD-63",
  REPORT_SAVED: "report.saved",
  REPORT_DELETED: "report.deleted",
  TILE_SET: "dashboard.tile.set",
};
