"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "wms_equipment", pk: "wms_equipment_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
