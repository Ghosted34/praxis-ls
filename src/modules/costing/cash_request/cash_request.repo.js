"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "cash_request", pk: "cash_request_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
