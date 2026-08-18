"use strict";
const service = require("./treasury_account.service");
const validator = require("./treasury_account.validator");
module.exports = {
  entity: "treasury_account", module_key: "MOD-09", screens: [],
  reads: [
    { key: "list_treasury_accounts", service: service.list, permission: { module: "MOD-09", action: "view" }, describe: "List treasury accounts (bank/cash/MoMo)." },
    { key: "get_treasury_account", service: service.get, permission: { module: "MOD-09", action: "view" }, describe: "Get a treasury account by id." },
  ],
  writes: [
    { key: "create_treasury_account", service: service.create, schema: validator.schemas.create, permission: { module: "MOD-09", action: "create" }, confirm: true, describe: "Add a treasury account mapped to a class-5 GL account." },
    { key: "update_treasury_account", service: (c, p) => (({ treasury_account_id, ...patch }) => service.update(c, { id: treasury_account_id, patch }))(p), schema: validator.schemas.aiUpdate, permission: { module: "MOD-09", action: "edit" }, confirm: true, describe: "Edit a treasury account by id." },
    { key: "set_treasury_account_active", service: (c, p) => service.setActive(c, { id: p.treasury_account_id, active: p.active }), schema: validator.schemas.aiSetActive, permission: { module: "MOD-09", action: "edit" }, confirm: true, describe: "Activate/deactivate a treasury account by id." },
  ],
};
