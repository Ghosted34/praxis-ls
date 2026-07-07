"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "fuel_log", pk: "fuel_log_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
