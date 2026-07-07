"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "sop_document", pk: "sop_document_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
