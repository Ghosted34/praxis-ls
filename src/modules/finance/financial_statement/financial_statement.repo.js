"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "financial_statement", pk: "financial_statement_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
