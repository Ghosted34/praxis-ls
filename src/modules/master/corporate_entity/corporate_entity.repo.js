"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "corporate_entity", pk: "entity_id", activeColumn: "is_active", searchColumn: "legal_name" });
