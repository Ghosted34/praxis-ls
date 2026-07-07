"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "attendance_log", pk: "attendance_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
