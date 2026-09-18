/** AI action manifest (AI_READINESS Rule 1) for WMS equipment. */
"use strict";

const service = require("./equipment.service");
const validator = require("./equipment.validator");

module.exports = {
  entity: "equipment",
  module_key: "MOD-37",
  screens: ["equipment"],

  reads: [
    { key: "list_equipment", service: service.list, permission: { module: "MOD-37", action: "view" }, describe: "List handling equipment (forklifts, reach-stackers)." },
    { key: "get_equipment", service: service.get, permission: { module: "MOD-37", action: "view" }, describe: "Get one equipment unit by id." },
  ],

  writes: [
    {
      key: "create_equipment",
      service: (c, p, actor) => service.create(c, { data: p, actor }),
      schema: validator.schemas.create,
      permission: { module: "MOD-37", action: "create" },
      confirm: true,
      describe: "Register a handling equipment unit.",
    },
    {
      key: "update_equipment",
      service: (c, p, actor) => (({ wms_equipment_id, ...patch }) => service.update(c, { id: wms_equipment_id, patch, actor }))(p),
      schema: validator.schemas.aiUpdate,
      permission: { module: "MOD-37", action: "edit" },
      confirm: true,
      describe: "Update an equipment unit (label, asset link, location).",
    },
    {
      key: "set_equipment_status",
      service: (c, p, actor) => service.setStatus(c, { id: p.wms_equipment_id, status: p.status, assigned_to: p.assigned_to, actor }),
      schema: validator.schemas.aiStatus,
      permission: { module: "MOD-37", action: "edit" },
      confirm: true,
      describe: "Change equipment status (AVAILABLE / IN_USE / MAINTENANCE / OUT_OF_SERVICE).",
    },
  ],
};
