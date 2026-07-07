"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "employee", pk: "employee_id", activeColumn: "is_active", searchColumn: "full_name" });
