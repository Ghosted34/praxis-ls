"use strict";
const service = require("./document_signature.service");
const validator = require("./document_signature.validator");
module.exports = {
  entity: "document_signature",
  module_key: "MOD-64",
  screens: [],
  reads: [{ key: "list_signatures", service: service.listByRef, permission: { module: "MOD-64", action: "view" }, describe: "List signatures on a document (by entity_ref)." }],
  writes: [{
    key: "sign_document", service: service.sign, schema: validator.schemas.sign,
    permission: { module: "MOD-64", action: "approve" }, confirm: true,
    describe: "Record a signature on a document, tied to its content hash.",
  }],
};
