/** AI action manifest (AI_READINESS Rule 1) for maintenance work orders. */
"use strict";

const service = require("./work_order.service");
const validator = require("./work_order.validator");

module.exports = {
  entity: "work_order",
  module_key: "MOD-41",
  screens: ["work-orders"],

  reads: [
    { key: "list_work_orders", service: service.list, permission: { module: "MOD-41", action: "view" }, describe: "List maintenance work orders." },
    { key: "get_work_order", service: service.get, permission: { module: "MOD-41", action: "view" }, describe: "Get one work order by id." },
  ],

  writes: [
    {
      key: "create_work_order",
      service: (c, p, actor) => service.create(c, { data: p, actor }),
      schema: validator.schemas.create,
      permission: { module: "MOD-41", action: "create" },
      confirm: true,
      describe: "Open a preventive or corrective work order for a vehicle or equipment.",
    },
    {
      key: "update_work_order",
      service: (c, p, actor) => (({ work_order_id, ...patch }) => service.update(c, { id: work_order_id, patch, actor }))(p),
      schema: validator.schemas.aiUpdate,
      permission: { module: "MOD-41", action: "edit" },
      confirm: true,
      describe: "Update a work order (description, cost, linked operations file).",
    },
    {
      key: "set_work_order_status",
      service: (c, p, actor) => service.setStatus(c, { id: p.work_order_id, status: p.status, actor }),
      schema: validator.schemas.aiStatus,
      permission: { module: "MOD-41", action: "edit" },
      confirm: true,
      describe: "Advance a work order (OPEN → IN_PROGRESS → DONE, or CANCELLED).",
    },
  ],
};
