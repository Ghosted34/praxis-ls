/** AI action manifest (AI_READINESS Rule 1) for fleet incidents. */
"use strict";

const service = require("./incident.service");
const validator = require("./incident.validator");

module.exports = {
  entity: "incident",
  module_key: "MOD-45",
  screens: ["incidents"],

  reads: [
    { key: "list_incidents", service: service.list, describe: "List fleet incidents." },
    { key: "get_incident", service: service.get, describe: "Get one incident by id." },
  ],

  writes: [
    {
      key: "create_incident",
      service: service.create,
      schema: validator.schemas.create,
      permission: { module: "MOD-45", action: "create" },
      confirm: true,
      describe: "Log a fleet incident (vehicle, driver, severity).",
    },
    {
      key: "update_incident",
      service: service.update,
      schema: validator.schemas.update,
      permission: { module: "MOD-45", action: "update" },
      confirm: true,
      describe: "Update an incident (description, severity).",
    },
    {
      key: "set_incident_status",
      service: service.setStatus,
      schema: validator.schemas.status,
      permission: { module: "MOD-45", action: "update" },
      confirm: true,
      describe: "Advance an incident (OPEN → UNDER_REVIEW → CLOSED).",
    },
  ],
};
