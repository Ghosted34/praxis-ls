"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "talent_pool", pk: "talent_pool_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
