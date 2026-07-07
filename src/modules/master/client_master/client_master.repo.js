"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "client_master", pk: "client_id", activeColumn: "is_active", searchColumn: "name" });
