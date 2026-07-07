"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "cost_entry", pk: "cost_entry_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
