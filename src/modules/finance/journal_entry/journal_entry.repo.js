"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "journal_entry", pk: "entry_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
