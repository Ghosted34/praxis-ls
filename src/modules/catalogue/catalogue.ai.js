/**
 * AI action manifest (AI_ARCHITECTURE §2) for the module catalogue (MOD-67).
 *
 * One read: which modules this deployment has, with their keys. It is what
 * answers "what can Praxis do" and "which module is MOD-62" without the
 * assistant guessing from a key it saw in a permission string.
 *
 * Read-only by nature — the catalogue is the deployment's own inventory, not
 * tenant data anyone edits.
 */
"use strict";

const service = require("./catalogue.service");

const MOD = "MOD-67";

module.exports = {
  entity: "module_catalogue",
  module_key: MOD,
  screens: [],

  reads: [
    { key: "list_modules", service: () => service.listModules(), permission: { module: MOD, action: "view" }, describe: "Every module in this deployment with its key (MOD-xx), name and group — the map behind every other action's module_key." },
  ],

  writes: [],
};
