"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "vehicle", pk: "vehicle_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
