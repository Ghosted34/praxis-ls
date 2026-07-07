"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "saved_report", pk: "saved_report_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
