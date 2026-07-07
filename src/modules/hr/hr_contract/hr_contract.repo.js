"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "hr_contract", pk: "hr_contract_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
