"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "inventory_item", pk: "inventory_item_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
