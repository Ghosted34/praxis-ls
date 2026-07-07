"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "immutable_ledger", pk: "ledger_id", activeColumn: null, searchColumn: null, orderBy: "ledger_id DESC" });
