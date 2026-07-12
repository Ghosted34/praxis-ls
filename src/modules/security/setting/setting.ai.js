"use strict";
const service = require("./setting.service");
const validator = require("./setting.validator");
module.exports = {
  entity: "setting", module_key: "MOD-70", screens: [],
  reads: [
    { key: "list_settings", service: (c) => service.all(c), describe: "All tenant settings grouped by section." },
    { key: "get_settings_section", service: (c, p) => service.section(c, p.section), describe: "All settings in a section (numbering, finance, email, …)." },
  ],
  writes: [
    { key: "set_setting", service: (c, p) => service.put(c, p), schema: validator.schemas.put, permission: { module: "MOD-70", action: "edit" }, confirm: true, describe: "Upsert one (section,key) setting value (version-bumped, audited)." },
  ],
};
