"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "payroll_run", pk: "payroll_run_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
