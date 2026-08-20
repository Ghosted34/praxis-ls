"use strict";

const service = require("./document_signature.service");
const validator = require("./document_signature.validator");

/**
 * AI catalogue (doc/AI_ARCHITECTURE.md): reads are free, writes are confirmed.
 *
 * Signing stays `confirm: true` and always will. An assistant that could put a
 * person's name on a contract without that person pressing a button would make
 * every signature in the tenant arguable — which is the opposite of what this
 * module exists for.
 */
module.exports = {
  entity: "document_signature",
  module_key: "MOD-64",
  screens: [],
  reads: [
    {
      key: "list_signatures",
      service: (client, args) => service.listByRef(client, args && args.entity_ref),
      permission: { module: "MOD-64", action: "view" },
      describe: "List signatures on a document, each with its live status (VALID / AMENDED / REVOKED).",
    },
    {
      key: "signature_menu",
      service: (client, args) => service.menu(client, { docType: args && args.doc_type }),
      permission: { module: "MOD-64", action: "view" },
      describe: "The signature methods available for a document type.",
    },
  ],
  writes: [
    {
      key: "sign_document",
      service: service.signInternal,
      schema: validator.schemas.signInternal,
      permission: { module: "MOD-64", action: "approve" },
      confirm: true,
      describe: "Sign a document as the current user, tied to its canonical content hash.",
    },
  ],
};
