"use strict";
const service = require("./document_verification.service");
module.exports = {
  entity: "document_verification", module_key: "MOD-66", screens: [],
  reads: [{ key: "verify_document", service: service.verify, describe: "Verify a document by doc_id/entity_ref + hash (QR tamper check)." }],
  writes: [],
};
