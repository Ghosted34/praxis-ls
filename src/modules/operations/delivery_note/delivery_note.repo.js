"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "delivery_note", pk: "delivery_note_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
