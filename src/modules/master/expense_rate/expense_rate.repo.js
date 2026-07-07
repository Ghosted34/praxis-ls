"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "expense_rate", pk: "expense_rate_id", activeColumn: null, searchColumn: null });
