/** AI action manifest (AI_READINESS Rule 1) for outbound orders. */
"use strict";

const service = require("./outbound.service");
const validator = require("./outbound.validator");

module.exports = {
  entity: "outbound",
  module_key: "MOD-36",
  screens: ["outbound"],

  reads: [
    { key: "list_outbound", service: service.list, describe: "List outbound orders." },
    { key: "get_outbound", service: service.get, describe: "Get one outbound order by id." },
    { key: "list_outbound_lines", service: service.listLines, describe: "List the lines of an outbound order." },
  ],

  writes: [
    {
      key: "create_outbound",
      service: service.create,
      schema: validator.schemas.create,
      permission: { module: "MOD-36", action: "create" },
      confirm: true,
      describe: "Create an outbound order for a client / dossier.",
    },
    {
      key: "update_outbound",
      service: service.update,
      schema: validator.schemas.update,
      permission: { module: "MOD-36", action: "edit" },
      confirm: true,
      describe: "Update an outbound order header.",
    },
    {
      key: "set_outbound_status",
      service: service.setStatus,
      schema: validator.schemas.status,
      permission: { module: "MOD-36", action: "edit" },
      confirm: true,
      describe: "Advance an outbound order (CREATED → PICKING → PACKED → DISPATCHED, or CANCELLED).",
    },
    {
      key: "add_outbound_line",
      service: service.addLine,
      schema: validator.schemas.line,
      permission: { module: "MOD-36", action: "edit" },
      confirm: true,
      describe: "Add a pick line (inventory item + qty) to an outbound order.",
    },
    {
      key: "set_outbound_line_flags",
      service: service.setLineFlags,
      schema: validator.schemas.lineFlags,
      permission: { module: "MOD-36", action: "edit" },
      confirm: true,
      describe: "Flag an outbound line as picked and/or packed.",
    },
  ],
};
