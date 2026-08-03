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
    { key: "create_asset", service: (c, p) => service.create(c, { data: p }), schema: validator.schemas.create, permission: { module: "MOD-54", action: "create" }, confirm: true, describe: "Register a fixed asset; generates the depreciation schedule (KB §11)." },
    { key: "update_asset", service: (c, p) => (({ asset_id, ...patch }) => service.update(c, { id: asset_id, patch }))(p), schema: validator.schemas.aiUpdate, permission: { module: "MOD-54", action: "edit" }, confirm: true, describe: "Update asset metadata by id (label, tag, COA accounts)." },
    { key: "depreciate_asset", service: (c, p) => service.depreciate(c, { id: p.asset_id, period_code: p.period_code }), schema: validator.schemas.aiDepreciate, permission: { module: "MOD-54", action: "edit" }, confirm: true, describe: "Post one period's depreciation for an asset (by id) to the ledger." },
    { key: "dispose_asset", service: (c, p) => service.dispose(c, { id: p.asset_id, disposed_on: p.disposed_on, proceeds: p.proceeds }), schema: validator.schemas.aiDispose, permission: { module: "MOD-54", action: "approve" }, confirm: true, describe: "Dispose an asset (by id) and recognise gain/loss vs net book value." },
  ],
};
