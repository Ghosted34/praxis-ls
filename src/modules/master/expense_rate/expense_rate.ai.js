"use strict";
const service = require("./expense_rate.service");
const validator = require("./expense_rate.validator");
module.exports = {
  entity: "expense_rate", module_key: "MOD-10", screens: [],
  reads: [
    { key: "list_expense_rates", service: service.list, permission: { module: "MOD-10", action: "view" }, describe: "List expense rate cards." },
    { key: "get_expense_rate", service: service.get, permission: { module: "MOD-10", action: "view" }, describe: "Get an expense rate by id." },
    { key: "resolve_expense_rate", service: service.resolve, permission: { module: "MOD-10", action: "view" }, describe: "Resolve the effective rate for an item at a date, optionally scoped to a carrier/authority and container type." },
  ],
  writes: [
    { key: "create_expense_rate", service: (c, p, actor) => service.create(c, { dictionaryItemId: p.dictionary_item_id, rateProviderId: p.rate_provider_id, containerTypeRefId: p.container_type_ref_id, rate: p.rate, currency: p.currency, effectiveFrom: p.effective_from, effectiveTo: p.effective_to, note: p.note, actor }), schema: validator.schemas.create, permission: { module: "MOD-10", action: "create" }, confirm: true, describe: "Add an effective-dated expense rate, optionally scoped to a carrier/authority and container type." },
    { key: "update_expense_rate", service: (c, p, actor) => (({ expense_rate_id, ...patch }) => service.update(c, { id: expense_rate_id, patch, actor }))(p), schema: validator.schemas.aiUpdate, permission: { module: "MOD-10", action: "edit" }, confirm: true, describe: "Edit an expense rate by id." },
  ],
};
