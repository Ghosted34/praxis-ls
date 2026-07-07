"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "leave_request", pk: "leave_request_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
