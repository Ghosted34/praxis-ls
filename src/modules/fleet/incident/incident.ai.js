/** AI action manifest (AI_READINESS Rule 1) for fleet incidents. */
"use strict";

const service = require("./incident.service");
const validator = require("./incident.validator");

module.exports = {
  entity: "incident",
  module_key: "MOD-45",
  screens: ["incidents"],

  reads: [
    { key: "list_incidents", service: service.list, permission: { module: "MOD-45", action: "view" }, describe: "List fleet incidents." },
    { key: "get_incident", service: service.get, permission: { module: "MOD-45", action: "view" }, describe: "Get one incident by id." },
  ],

  writes: [
    {
      key: "create_incident",
      service: (c, p, actor) => service.create(c, { data: p, actor }),
      schema: validator.schemas.create,
      permission: { module: "MOD-45", action: "create" },
      confirm: true,
      describe: "Log a fleet incident (vehicle, driver, severity).",
    },
    {
      key: "update_incident",
      service: (c, p, actor) => (({ fleet_incident_id, ...patch }) => service.update(c, { id: fleet_incident_id, patch, actor }))(p),
      schema: validator.schemas.aiUpdate,
      permission: { module: "MOD-45", action: "edit" },
      confirm: true,
      describe: "Update an incident (description, severity).",
    },
    {
      key: "set_incident_status",
      service: (c, p, actor) => service.setStatus(c, { id: p.fleet_incident_id, status: p.status, actor }),
      schema: validator.schemas.aiStatus,
      permission: { module: "MOD-45", action: "edit" },
      confirm: true,
      describe: "Advance an incident (OPEN → UNDER_REVIEW → CLOSED).",
    },
  ],
};
