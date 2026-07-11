/** AI action manifest (AI_READINESS Rule 1) for vehicle compliance. */
"use strict";

const service = require("./vehicle_compliance.service");
const validator = require("./vehicle_compliance.validator");

module.exports = {
  entity: "vehicle_compliance",
  module_key: "MOD-40",
  screens: ["vehicle-compliance"],

  reads: [
    { key: "list_compliance", service: service.list, describe: "List vehicle compliance records (insurance, visite technique) with alert level." },
    { key: "get_compliance", service: service.get, describe: "Get one compliance record by id." },
    { key: "compliance_expiring", service: service.expiring, describe: "Preview compliance records expiring within N days (no alerts fired)." },
  ],

  writes: [
    {
      key: "create_compliance",
      service: service.create,
      schema: validator.schemas.create,
      permission: { module: "MOD-40", action: "create" },
      confirm: true,
      describe: "Record a vehicle compliance document with an expiry date.",
    },
    {
      key: "update_compliance",
      service: service.update,
      schema: validator.schemas.update,
      permission: { module: "MOD-40", action: "update" },
      confirm: true,
      describe: "Update a compliance record (kind, expiry, attached document).",
    },
  ],
};
