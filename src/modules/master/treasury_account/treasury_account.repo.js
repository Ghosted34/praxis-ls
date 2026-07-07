"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "treasury_account", pk: "treasury_account_id", activeColumn: "is_active", searchColumn: "label" });
