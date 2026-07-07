"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "transit_order", pk: "transit_order_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
