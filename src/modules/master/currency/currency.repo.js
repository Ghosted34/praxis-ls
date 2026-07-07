"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "currency", pk: "code", activeColumn: null, searchColumn: null, orderBy: "code" });
