"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "fleet_dispatch", pk: "fleet_dispatch_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
