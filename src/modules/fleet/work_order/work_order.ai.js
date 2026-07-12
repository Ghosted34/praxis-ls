/** AI action manifest (AI_READINESS Rule 1) for maintenance work orders. */
"use strict";

const service = require("./work_order.service");
const validator = require("./work_order.validator");

module.exports = {
  entity: "work_order",
  module_key: "MOD-41",
  screens: ["work-orders"],

  reads: [
    { key: "list_work_orders", service: service.list, describe: "List maintenance work orders." },
    { key: "get_work_order", service: service.get, describe: "Get one work order by id." },
  ],

  writes: [
    {
      key: "create_work_order",
      service: service.create,
      schema: validator.schemas.create,
      permission: { module: "MOD-41", action: "create" },
      confirm: true,
      describe: "Open a preventive or corrective work order for a vehicle or equipment.",
    },
    {
      key: "update_work_order",
      service: service.update,
      schema: validator.schemas.update,
      permission: { module: "MOD-41", action: "edit" },
      confirm: true,
      describe: "Update a work order (description, cost, linked dossier).",
    },
    {
      key: "set_work_order_status",
      service: service.setStatus,
      schema: validator.schemas.status,
      permission: { module: "MOD-41", action: "edit" },
      confirm: true,
      describe: "Advance a work order (OPEN → IN_PROGRESS → DONE, or CANCELLED).",
    },
  ],
};
