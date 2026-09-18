/** AI action manifest (AI_READINESS Rule 1) for outbound orders. */
"use strict";

const service = require("./outbound.service");
const validator = require("./outbound.validator");

module.exports = {
  entity: "outbound",
  module_key: "MOD-36",
  screens: ["outbound"],

  reads: [
    { key: "list_outbound", service: service.list, permission: { module: "MOD-36", action: "view" }, describe: "List outbound orders." },
    { key: "get_outbound", service: service.get, permission: { module: "MOD-36", action: "view" }, describe: "Get one outbound order by id." },
    { key: "list_outbound_lines", service: service.listLines, permission: { module: "MOD-36", action: "view" }, describe: "List the lines of an outbound order." },
  ],

  writes: [
    {
      key: "create_outbound",
      service: (c, p, actor) => service.create(c, { data: p, actor }),
      schema: validator.schemas.create,
      permission: { module: "MOD-36", action: "create" },
      confirm: true,
      describe: "Create an outbound order for a client / operations file.",
    },
    {
      key: "update_outbound",
      service: (c, p, actor) => (({ outbound_order_id, ...patch }) => service.update(c, { id: outbound_order_id, patch, actor }))(p),
      schema: validator.schemas.aiUpdate,
      permission: { module: "MOD-36", action: "edit" },
      confirm: true,
      describe: "Update an outbound order header.",
    },
    {
      key: "set_outbound_status",
      service: (c, p, actor) => service.setStatus(c, { id: p.outbound_order_id, status: p.status, actor }),
      schema: validator.schemas.aiStatus,
      permission: { module: "MOD-36", action: "edit" },
      confirm: true,
      describe: "Advance an outbound order (CREATED → PICKING → PACKED → DISPATCHED, or CANCELLED).",
    },
    {
      key: "add_outbound_line",
      service: (c, p, actor) => (({ outbound_order_id, ...data }) => service.addLine(c, { orderId: outbound_order_id, data, actor }))(p),
      schema: validator.schemas.aiLine,
      permission: { module: "MOD-36", action: "edit" },
      confirm: true,
      describe: "Add a pick line (inventory item + qty) to an outbound order.",
    },
    {
      key: "set_outbound_line_flags",
      service: (c, p, actor) => service.setLineFlags(c, { orderId: p.outbound_order_id, lineId: p.outbound_line_id, picked: p.picked, packed: p.packed, actor }),
      schema: validator.schemas.aiLineFlags,
      permission: { module: "MOD-36", action: "edit" },
      confirm: true,
      describe: "Flag an outbound line as picked and/or packed.",
    },
  ],
};
