"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "outbound_order", pk: "outbound_order_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
