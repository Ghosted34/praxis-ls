"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "setting", pk: "setting_id", activeColumn: null, searchColumn: null, orderBy: "updated_at DESC" });
