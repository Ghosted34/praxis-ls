"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "scope", pk: "scope_id", activeColumn: null, searchColumn: "name", orderBy: "name ASC" });
