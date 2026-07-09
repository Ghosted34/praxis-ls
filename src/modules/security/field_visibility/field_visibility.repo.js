"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "field_visibility", pk: "field_visibility_id", activeColumn: null, searchColumn: "field_key", orderBy: "field_key ASC" });
