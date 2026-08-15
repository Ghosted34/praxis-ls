"use strict";
module.exports = {
  MODULE: "MOD-14",
  CREATED: "attendance.created",
  UPDATED: "attendance.updated",
  ARCHIVED: "attendance.archived",
  CLOCKED_IN: "attendance.clocked_in",
  CLOCKED_OUT: "attendance.clocked_out",
  OFFSITE: "attendance.offsite_clock_in",
  SITE_CHANGED: "work_site.changed",
  // A punch from a device that is PENDING or REVOKED. Emitted even when the
  // policy accepted it — under `warn` this event is the only trace.
  UNTRUSTED_DEVICE: "attendance.untrusted_device",
  DEVICE_CHANGED: "hr_device.changed",
};
