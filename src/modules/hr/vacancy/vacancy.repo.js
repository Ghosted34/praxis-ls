"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "vacancy", pk: "vacancy_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
