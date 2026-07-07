"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "grn_inbound", pk: "grn_inbound_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
