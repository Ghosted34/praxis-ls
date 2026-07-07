"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "document_vault", pk: "doc_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
