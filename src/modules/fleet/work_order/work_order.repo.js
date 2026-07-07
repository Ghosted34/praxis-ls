"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "work_order", pk: "work_order_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
