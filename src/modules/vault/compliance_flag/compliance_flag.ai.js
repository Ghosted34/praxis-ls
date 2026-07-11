"use strict";
const service = require("./compliance_flag.service");
const validator = require("./compliance_flag.validator");
module.exports = {
  entity: "compliance_flag", module_key: "MOD-65", screens: [],
  reads: [
    { key: "list_compliance_flags", service: (c, p) => service.list(c, p), describe: "Open compliance flags (missing proofs, unmatched procurement, aged régie, débours tax)." },
    { key: "compliance_rules", service: () => service.catalogue(), describe: "The compliance rule catalogue + severities." },
  ],
  writes: [
    { key: "run_compliance_check", service: service.run, schema: validator.schemas.run, permission: { module: "MOD-65", action: "edit" }, confirm: true, describe: "Run the compliance checker (all rules or a subset)." },
    { key: "resolve_compliance_flag", service: (c, p) => service.resolve(c, { id: p.id }), schema: validator.schemas.run, permission: { module: "MOD-65", action: "edit" }, confirm: true, describe: "Mark a compliance flag resolved." },
  ],
};
