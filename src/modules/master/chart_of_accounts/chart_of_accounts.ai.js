"use strict";
const service = require("./chart_of_accounts.service");
const validator = require("./chart_of_accounts.validator");
module.exports = {
  entity: "chart_of_accounts", module_key: "MOD-06", screens: [],
  reads: [
    { key: "list_accounts", service: service.list, describe: "List chart-of-accounts (filter class/postable/parent)." },
    { key: "get_account", service: service.get, describe: "Get an account by code." },
  ],
  writes: [
    { key: "create_account", service: service.create, schema: validator.schemas.create, permission: { module: "MOD-06", action: "create" }, confirm: true, describe: "Add a tenant sub-account (class-consistent; leaf becomes postable)." },
    { key: "update_account", service: service.update, schema: validator.schemas.update, permission: { module: "MOD-06", action: "edit" }, confirm: true, describe: "Edit an account (statutory rows: labels/flags only)." },
  ],
};
