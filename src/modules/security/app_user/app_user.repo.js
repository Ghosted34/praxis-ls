"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "app_user", pk: "user_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
