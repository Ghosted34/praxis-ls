"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "capability", pk: "capability_id", activeColumn: null, searchColumn: "name", orderBy: "name ASC" });
