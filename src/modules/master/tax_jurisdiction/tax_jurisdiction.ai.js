"use strict";
const service = require("./tax_jurisdiction.service");
const validator = require("./tax_jurisdiction.validator");
module.exports = {
  entity: "tax_jurisdiction", module_key: "MOD-07", screens: [],
  reads: [
    { key: "list_tax_jurisdictions", service: service.list, permission: { module: "MOD-07", action: "view" }, describe: "List tax jurisdictions." },
    { key: "get_tax_jurisdiction", service: service.get, permission: { module: "MOD-07", action: "view" }, describe: "Get a jurisdiction with its tax codes." },
    { key: "list_tax_codes", service: service.listCodes, permission: { module: "MOD-07", action: "view" }, describe: "List tax codes under a jurisdiction." },
    { key: "effective_tax_code", service: service.effectiveCode, permission: { module: "MOD-07", action: "view" }, describe: "Resolve the tax code effective at a date." },
  ],
  writes: [
    { key: "create_tax_jurisdiction", service: service.createJurisdiction, schema: validator.schemas.create, permission: { module: "MOD-07", action: "create" }, confirm: true, describe: "Create a tax jurisdiction." },
    { key: "add_tax_code", service: service.addCode, schema: validator.schemas.addCode, permission: { module: "MOD-07", action: "create" }, confirm: true, describe: "Add an effective-dated tax code (TVA/WHT/IS/min)." },
  ],
};
