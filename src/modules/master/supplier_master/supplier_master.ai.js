"use strict";
const service = require("./supplier_master.service");
const validator = require("./supplier_master.validator");
module.exports = {
  entity: "supplier_master", module_key: "MOD-04", screens: [],
  reads: [
    { key: "list_suppliers", service: service.list, describe: "List suppliers." },
    { key: "get_supplier", service: service.get, describe: "Get a supplier by id." },
  ],
  writes: [
    { key: "create_supplier", service: service.create, schema: validator.schemas.create, permission: { module: "MOD-04", action: "create" }, confirm: true, describe: "Register a supplier (mobile money, non-resident SIT flag)." },
    { key: "update_supplier", service: service.update, schema: validator.schemas.update, permission: { module: "MOD-04", action: "edit" }, confirm: true, describe: "Update a supplier." },
  ],
};
