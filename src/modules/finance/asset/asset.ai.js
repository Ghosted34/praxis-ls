/** Asset (MOD-54) AI manifest — reads open; writes confirm-gated + RBAC. */
"use strict";
const service = require("./asset.service");
const validator = require("./asset.validator");

module.exports = {
  entity: "asset",
  module_key: "MOD-54",
  screens: ["finance_assets"],
  reads: [
    { key: "list_assets", service: service.list, describe: "List fixed assets (by entity/status)." },
    { key: "get_asset", service: service.get, describe: "Get an asset with its depreciation schedule and net book value." },
  ],
  writes: [
    { key: "create_asset", service: service.create, schema: validator.schemas.create, permission: { module: "MOD-54", action: "create" }, confirm: true, describe: "Register a fixed asset; generates the depreciation schedule (KB §11)." },
    { key: "update_asset", service: service.update, schema: validator.schemas.update, permission: { module: "MOD-54", action: "edit" }, confirm: true, describe: "Update asset metadata (label, tag, COA accounts)." },
    { key: "depreciate_asset", service: service.depreciate, schema: validator.schemas.depreciate, permission: { module: "MOD-54", action: "edit" }, confirm: true, describe: "Post one period's depreciation to the ledger." },
    { key: "dispose_asset", service: service.dispose, schema: validator.schemas.dispose, permission: { module: "MOD-54", action: "approve" }, confirm: true, describe: "Dispose an asset and recognise gain/loss vs net book value." },
  ],
};
