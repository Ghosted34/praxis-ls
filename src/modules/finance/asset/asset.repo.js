"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "asset", pk: "asset_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
