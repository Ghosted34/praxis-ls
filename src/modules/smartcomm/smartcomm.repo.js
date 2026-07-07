"use strict";
const { makeRepo } = require("../../shared/crud/resource");
module.exports = makeRepo({ table: "comms_group", pk: "group_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
