"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "purchase_request", pk: "pr_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
