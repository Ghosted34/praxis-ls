"use strict";
const service = require("./final_invoice.service");
const validator = require("./final_invoice.validator");
module.exports = {
  entity: "final_invoice", ai_writes: false,
  module_key: "MOD-51",
  screens: [],
  reads: [
    { key: "list_final_invoices", service: service.list, describe: "List final invoices (filter status/client)." },
    { key: "get_final_invoice", service: service.get, describe: "Get a final invoice by id, with its lines." },
  ],
  writes: [
    { key: "draft_final_invoice", service: service.createDraft, schema: validator.schemas.createDraft, permission: { module: "MOD-51", action: "create" }, confirm: true, describe: "Create a DRAFT final invoice (no GL yet)." },
    { key: "update_final_invoice", service: service.updateDraft, schema: validator.schemas.updateDraft, permission: { module: "MOD-51", action: "edit" }, confirm: true, describe: "Edit a DRAFT final invoice." },
    { key: "submit_final_invoice", service: service.submit, schema: validator.schemas.submit, permission: { module: "MOD-51", action: "approve" }, confirm: true, describe: "Submit for approval; auto-posts (revenue+débours+VAT, clears advance, numbers + captures the doc) when no workflow is bound. KB §8.3." },
  ],
};
