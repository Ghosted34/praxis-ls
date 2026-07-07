"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "goods_received_note", pk: "grn_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
