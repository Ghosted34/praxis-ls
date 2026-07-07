"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "warehouse_location", pk: "location_id", activeColumn: null, searchColumn: null, orderBy: "location_id" });
