/**
 * AI action manifest (AI_ARCHITECTURE §2) for succession plans (MOD-19).
 *
 * "Who is the successor for this role, and are they ready" is a planning
 * question with an answer already in the tenant's data — it just had no tool.
 */
"use strict";

const service = require("./succession.service");
const validator = require("./succession.validator");

const MOD = "MOD-19";

module.exports = {
  entity: "succession_plan",
  module_key: MOD,
  screens: [],

  reads: [
    { key: "list_succession_plans", service: service.list, permission: { module: MOD, action: "view" }, describe: "List succession plans (role, incumbent, named successor, readiness)." },
    { key: "get_succession_plan", service: service.get, permission: { module: MOD, action: "view" }, describe: "Get one succession plan by id." },
  ],

  writes: [
    {
      key: "create_succession_plan",
      service: (c, p, actor) => service.create(c, { data: p, actor }),
      schema: validator.schemas.create,
      permission: { module: MOD, action: "create" },
      confirm: true,
      describe: "Open a succession plan for a role (incumbent, named successor, readiness, notes).",
    },
    {
      key: "update_succession_plan",
      service: (c, p, actor) => (({ succession_plan_id, ...patch }) => service.update(c, { id: succession_plan_id, patch, actor }))(p),
      schema: validator.schemas.aiUpdate,
      permission: { module: MOD, action: "edit" },
      confirm: true,
      describe: "Update a succession plan by id (successor, readiness or notes).",
    },
  ],
};
