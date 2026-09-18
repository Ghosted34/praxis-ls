/** AI action manifest (AI_READINESS Rule 1) for inbound / GRN. */
"use strict";

const service = require("./inbound.service");
const validator = require("./inbound.validator");

module.exports = {
  entity: "inbound",
  module_key: "MOD-33",
  screens: ["inbound"],

  reads: [
    { key: "list_inbound", service: service.list, permission: { module: "MOD-33", action: "view" }, describe: "List goods-received notes (GRN)." },
    { key: "get_inbound", service: service.get, permission: { module: "MOD-33", action: "view" }, describe: "Get one GRN by id." },
  ],

  writes: [
    {
      key: "create_inbound",
      service: (c, p, actor) => service.create(c, { data: p, actor }),
      schema: validator.schemas.create,
      permission: { module: "MOD-33", action: "create" },
      confirm: true,
      describe: "Open a goods-received note for an operations file.",
    },
    {
      key: "update_inbound",
      service: (c, p, actor) => (({ grn_inbound_id, ...patch }) => service.update(c, { id: grn_inbound_id, patch, actor }))(p),
      schema: validator.schemas.aiUpdate,
      permission: { module: "MOD-33", action: "edit" },
      confirm: true,
      describe: "Update a GRN.",
    },
    {
      key: "set_inbound_qa",
      service: (c, p, actor) => service.setQa(c, { id: p.grn_inbound_id, qa_status: p.qa_status, putaway_location: p.putaway_location, actor }),
      schema: validator.schemas.aiQa,
      permission: { module: "MOD-33", action: "edit" },
      confirm: true,
      describe: "Clear QA on a GRN (PASSED with a putaway location, or REJECTED).",
    },
  ],
};
