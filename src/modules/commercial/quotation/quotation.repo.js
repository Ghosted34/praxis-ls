"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "quotation", pk: "quotation_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
