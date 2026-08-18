"use strict";
const service = require("./financial_dictionary.service");
const validator = require("./financial_dictionary.validator");
module.exports = {
  entity: "dictionary_item", module_key: "MOD-05", screens: [],
  reads: [
    { key: "list_dictionary_items", service: service.listItems, permission: { module: "MOD-05", action: "view" }, describe: "List financial dictionary items (services, débours, overheads)." },
    { key: "get_dictionary_item", service: service.get, permission: { module: "MOD-05", action: "view" }, describe: "Get a dictionary item with its posting rules." },
  ],
  writes: [
    { key: "create_dictionary_item", service: service.create, schema: validator.schemas.create, permission: { module: "MOD-05", action: "create" }, confirm: true, describe: "Create a dictionary item with ≥1 posting rule (KB §4)." },
    { key: "update_dictionary_item", service: service.update, schema: validator.schemas.update, permission: { module: "MOD-05", action: "edit" }, confirm: true, describe: "Edit a dictionary item and (optionally) replace its posting rules." },
  ],
};
