/**
 * AI action manifest (AI_ARCHITECTURE §2) for HR queries (MOD-71).
 *
 * An HR query is the formal "explain yourself" letter that precedes a sanction,
 * so it is both a thing managers ask about ("is there an open query on this
 * employee") and a thing they raise in words. `respond` is deliberately absent:
 * a reply is the EMPLOYEE's own statement, made from My HR on their own
 * account, and an assistant writing it on their behalf would put words in a
 * disciplinary record that they never said.
 */
"use strict";

const service = require("./hr_query.service");
const validator = require("./hr_query.validator");

const MOD = "MOD-71";

module.exports = {
  entity: "hr_query",
  module_key: MOD,
  screens: [],

  reads: [
    { key: "list_hr_queries", service: service.list, permission: { module: MOD, action: "view" }, describe: "List HR queries (filter by employee, severity or status)." },
    { key: "get_hr_query", service: service.get, permission: { module: MOD, action: "view" }, describe: "Get one HR query by id, with the employee's response if there is one." },
  ],

  writes: [
    {
      key: "create_hr_query",
      service: (c, p, actor) => service.create(c, { data: p, actor }),
      schema: validator.schemas.create,
      permission: { module: MOD, action: "create" },
      confirm: true,
      describe: "Issue an HR query to an employee (subject, body, severity, due date). The issuer is stamped from the caller.",
    },
    {
      key: "update_hr_query",
      service: (c, p, actor) => (({ hr_query_id, ...patch }) => service.update(c, { id: hr_query_id, patch, actor }))(p),
      schema: validator.schemas.aiUpdate,
      permission: { module: MOD, action: "edit" },
      confirm: true,
      describe: "Amend an HR query by id (subject, body, severity or due date).",
    },
  ],
};
