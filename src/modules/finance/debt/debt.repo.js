"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "debt_engagement", pk: "debt_engagement_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
