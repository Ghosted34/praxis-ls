"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "margin_simulation", pk: "margin_simulation_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
