/**
 * AI action manifest (AI_ARCHITECTURE §2) for HR sanctions (MOD-71).
 *
 * A sanction is a disciplinary decision with a payroll consequence (a FINE
 * carries `amount_xaf`), so the assistant should be able to report on them and
 * to draft one for confirmation — never to apply one unseen. Every write here
 * is confirm-gated, like all of them, which is the point.
 */
"use strict";

const service = require("./hr_sanction.service");
const validator = require("./hr_sanction.validator");

const MOD = "MOD-71";

module.exports = {
  entity: "hr_sanction",
  module_key: MOD,
  screens: [],

  reads: [
    { key: "list_hr_sanctions", service: service.list, permission: { module: MOD, action: "view" }, describe: "List HR sanctions (filter by employee, type or active/lifted)." },
    { key: "get_hr_sanction", service: service.get, permission: { module: MOD, action: "view" }, describe: "Get one HR sanction by id, with the query it followed." },
  ],

  writes: [
    {
      key: "create_hr_sanction",
      service: (c, p, actor) => service.create(c, { data: p, actor }),
      schema: validator.schemas.create,
      permission: { module: MOD, action: "create" },
      confirm: true,
      describe: "Record a sanction against an employee (WARNING/SUSPENSION/DEMOTION/FINE/DISMISSAL), optionally citing the HR query it followed.",
    },
    {
      key: "update_hr_sanction",
      service: (c, p, actor) => (({ hr_sanction_id, ...patch }) => service.update(c, { id: hr_sanction_id, patch, actor }))(p),
      schema: validator.schemas.aiUpdate,
      permission: { module: MOD, action: "edit" },
      confirm: true,
      describe: "Amend a sanction by id (reason, amount, effective or end date).",
    },
    {
      key: "lift_hr_sanction",
      service: (c, p, actor) => service.lift(c, { id: p.hr_sanction_id, actor }),
      schema: validator.schemas.aiLift,
      permission: { module: MOD, action: "edit" },
      confirm: true,
      describe: "Lift a sanction by id, ending it early.",
    },
  ],
};
