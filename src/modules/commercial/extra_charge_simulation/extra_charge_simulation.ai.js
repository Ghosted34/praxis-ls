"use strict";
const service = require("./extra_charge_simulation.service");
const validator = require("./extra_charge_simulation.validator");
module.exports = {
  entity: "extra_charge_simulation", module_key: "MOD-28", screens: [],
  // Reads carry a permission for the same reason writes do. `action-authz.js`
  // FAILS CLOSED: an action whose `required_permission` is null is refused
  // outright ("declares no required permission, so it cannot be authorised"),
  // and `assertAllowed` runs on reads as well as writes (SEC H1). So these two
  // did not quietly leak — they could not execute at all. MOD-28 `view` is the
  // same grant the HTTP routes require, which is what makes the assistant's
  // reach equal to the app's rather than wider or narrower.
  reads: [
    { key: "list_extra_charge_simulations", service: service.list, permission: { module: "MOD-28", action: "view" }, describe: "List demurrage/detention simulations." },
    { key: "get_extra_charge_simulation", service: service.get, permission: { module: "MOD-28", action: "view" }, describe: "Get a demurrage simulation." },
  ],
  writes: [
    { key: "create_extra_charge_simulation", service: service.create, schema: validator.schemas.compute, permission: { module: "MOD-28", action: "create" }, confirm: true, describe: "Compute + persist a tiered demurrage/detention estimate." },
  ],
};
