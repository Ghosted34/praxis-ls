/** AI action manifest (AI_READINESS Rule 1) for attendance. */
"use strict";

const service = require("./attendance.service");
const validator = require("./attendance.validator");

module.exports = {
  entity: "attendance",
  module_key: "MOD-14",
  screens: ["attendance"],

  reads: [
    { key: "list_attendance", service: service.list, describe: "List attendance logs (clock-in/out)." },
    { key: "get_attendance", service: service.get, describe: "Get one attendance log by id." },
  ],

  writes: [
    {
      key: "create_attendance",
      service: service.create,
      schema: validator.schemas.create,
      permission: { module: "MOD-14", action: "create" },
      confirm: true,
      describe: "Log a clock-in for an employee (optional GPS).",
    },
    {
      key: "update_attendance",
      service: service.update,
      schema: validator.schemas.update,
      permission: { module: "MOD-14", action: "update" },
      confirm: true,
      describe: "Update an attendance log.",
    },
    {
      key: "clock_out_attendance",
      service: service.clockOut,
      schema: null,
      permission: { module: "MOD-14", action: "update" },
      confirm: true,
      describe: "Stamp clock-out on an open attendance row.",
    },
  ],
};
