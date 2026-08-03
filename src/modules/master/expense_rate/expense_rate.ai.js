"use strict";
const service = require("./expense_rate.service");
const validator = require("./expense_rate.validator");
module.exports = {
  entity: "expense_rate", module_key: "MOD-10", screens: [],
  reads: [
    { key: "list_expense_rates", service: service.list, describe: "List expense rate cards." },
    { key: "get_expense_rate", service: service.get, describe: "Get an expense rate by id." },
    { key: "resolve_expense_rate", service: service.resolve, describe: "Resolve the effective rate for an item at a date (line/variant)." },
  ],
  writes: [
    { key: "create_expense_rate", service: service.create, schema: validator.schemas.create, permission: { module: "MOD-10", action: "create" }, confirm: true, describe: "Add an effective-dated expense rate." },
    { key: "update_expense_rate", service: (c, p) => (({ expense_rate_id, ...patch }) => service.update(c, { id: expense_rate_id, patch }))(p), schema: validator.schemas.aiUpdate, permission: { module: "MOD-10", action: "edit" }, confirm: true, describe: "Edit an expense rate by id." },
  ],
};
