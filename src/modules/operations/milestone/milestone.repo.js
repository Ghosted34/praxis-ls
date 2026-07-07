"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "milestone_instance", pk: "milestone_instance_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
