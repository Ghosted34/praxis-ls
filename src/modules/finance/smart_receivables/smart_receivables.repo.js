"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "payment_receipt", pk: "receipt_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
