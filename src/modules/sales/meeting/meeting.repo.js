"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "meeting", pk: "meeting_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
