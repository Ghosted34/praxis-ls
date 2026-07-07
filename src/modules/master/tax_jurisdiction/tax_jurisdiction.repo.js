"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "tax_jurisdiction", pk: "jurisdiction_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
