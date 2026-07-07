"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "supplier_invoice", pk: "supplier_invoice_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
