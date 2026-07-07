"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "appraisal", pk: "appraisal_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
