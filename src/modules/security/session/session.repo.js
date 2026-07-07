"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "user_session", pk: "session_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
