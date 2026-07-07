"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "tax_declaration", pk: "tax_declaration_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
