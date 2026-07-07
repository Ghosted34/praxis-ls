"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "chart_of_accounts", pk: "code", activeColumn: "is_active", searchColumn: "label_fr" });
