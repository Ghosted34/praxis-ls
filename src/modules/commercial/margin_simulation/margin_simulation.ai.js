"use strict";
const service = require("./margin_simulation.service");
const validator = require("./margin_simulation.validator");
module.exports = {
  entity: "margin_simulation", module_key: "MOD-27", screens: [],
  reads: [
    { key: "list_margin_simulations", service: service.list, permission: { module: "MOD-27", action: "view" }, describe: "List margin simulations." },
    { key: "get_margin_simulation", service: service.get, permission: { module: "MOD-27", action: "view" }, describe: "Get a margin simulation with lines." },
  ],
  writes: [
    { key: "create_margin_simulation", service: service.create, schema: validator.schemas.compute, permission: { module: "MOD-27", action: "create" }, confirm: true, describe: "Compute + persist a margin simulation (margin on services only)." },
  ],
};
