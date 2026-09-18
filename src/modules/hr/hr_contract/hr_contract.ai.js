/** AI action manifest (AI_READINESS Rule 1) for HR contracts. */
"use strict";

const service = require("./hr_contract.service");
const validator = require("./hr_contract.validator");

module.exports = {
  entity: "hr_contract",
  module_key: "MOD-12",
  screens: ["contracts"],

  reads: [
    { key: "list_contracts", service: service.list, permission: { module: "MOD-12", action: "view" }, describe: "List HR contracts (offer, employment, confirmation, termination)." },
    { key: "get_contract", service: service.get, permission: { module: "MOD-12", action: "view" }, describe: "Get one contract by id." },
  ],

  writes: [
    {
      key: "create_contract",
      service: (c, p, actor) => service.create(c, { data: p, actor }),
      schema: validator.schemas.create,
      permission: { module: "MOD-12", action: "create" },
      confirm: true,
      describe: "Draft an HR contract for an employee.",
    },
    {
      key: "update_contract",
      service: (c, p, actor) => (({ hr_contract_id, ...patch }) => service.update(c, { id: hr_contract_id, patch, actor }))(p),
      schema: validator.schemas.aiUpdate,
      permission: { module: "MOD-12", action: "edit" },
      confirm: true,
      describe: "Update a contract (dates, attached PDF).",
    },
    {
      key: "set_contract_status",
      service: (c, p, actor) => service.setStatus(c, { id: p.hr_contract_id, status: p.status, actor }),
      schema: validator.schemas.aiStatus,
      permission: { module: "MOD-12", action: "edit" },
      confirm: true,
      describe: "Advance a contract (DRAFT → ISSUED → SIGNED → ENDED).",
    },
  ],
};
