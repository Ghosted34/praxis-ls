"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "driver_license", pk: "driver_license_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
