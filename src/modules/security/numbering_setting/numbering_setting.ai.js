"use strict";
const service = require("./numbering_setting.service");
const validator = require("./numbering_setting.validator");
module.exports = {
  entity: "numbering_scheme",
  module_key: "MOD-70",
  screens: ["settings_numbering"],
  reads: [{ key: "get_numbering_scheme", service: service.get, permission: { module: "MOD-70", action: "view" }, describe: "Get a module's document-numbering scheme + preview." }],
  writes: [{
    key: "set_numbering_scheme", service: service.put, schema: validator.schemas.put,
    permission: { module: "MOD-70", action: "edit" }, confirm: true,
    describe: "Set a tenant's document-numbering scheme (prefix/code/padding/reset/separator) for a module.",
  }],
};
