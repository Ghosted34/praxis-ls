"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "role", pk: "role_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
