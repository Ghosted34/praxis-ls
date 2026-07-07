"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "supplier_master", pk: "supplier_id", activeColumn: "is_active", searchColumn: "name" });
