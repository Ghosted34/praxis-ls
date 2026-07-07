"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "extra_charge_simulation", pk: "extra_charge_simulation_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
