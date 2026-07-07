"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "cycle_count", pk: "cycle_count_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
