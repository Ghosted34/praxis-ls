"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "lead", pk: "lead_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
