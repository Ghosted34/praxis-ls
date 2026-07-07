"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "dossier", pk: "dossier_id", activeColumn: null, searchColumn: null });
