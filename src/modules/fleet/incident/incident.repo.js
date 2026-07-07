"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "fleet_incident", pk: "fleet_incident_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
