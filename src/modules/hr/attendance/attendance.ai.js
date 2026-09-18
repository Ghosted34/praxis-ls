/** AI action manifest (AI_READINESS Rule 1) for attendance. */
"use strict";

const service = require("./attendance.service");
const validator = require("./attendance.validator");

module.exports = {
  entity: "attendance",
  module_key: "MOD-14",
  screens: ["attendance"],

  reads: [
    { key: "list_attendance", service: service.list, permission: { module: "MOD-14", action: "view" }, describe: "List attendance logs (clock-in/out)." },
    { key: "get_attendance", service: service.get, permission: { module: "MOD-14", action: "view" }, describe: "Get one attendance log by id." },
  ],

  writes: [
    {
      key: "create_attendance",
      service: (c, p, actor) => service.create(c, { data: p, actor }),
      schema: validator.schemas.create,
      permission: { module: "MOD-14", action: "create" },
      confirm: true,
      describe: "Log a clock-in for an employee (optional GPS).",
    },
    {
      key: "update_attendance",
      service: (c, p, actor) => (({ attendance_id, ...patch }) => service.update(c, { id: attendance_id, patch, actor }))(p),
      schema: validator.schemas.clockOut,
      permission: { module: "MOD-14", action: "edit" },
      confirm: true,
      describe: "Update an attendance log.",
    },
    {
      key: "clock_out_attendance",
      service: (c, p, actor) => service.clockOut(c, { id: p.id || null, employeeId: p.employee_id || null, latitude: p.latitude, longitude: p.longitude, actor }),
      schema: validator.schemas.clockOut,
      permission: { module: "MOD-14", action: "edit" },
      confirm: true,
      describe: "Stamp clock-out on an open attendance row.",
    },
  ],
};
