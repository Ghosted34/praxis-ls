"use strict";
const service = require("./final_invoice.service");
const validator = require("./final_invoice.validator");
module.exports = {
  entity: "final_invoice",
  module_key: "MOD-51",
  screens: [],
  reads: [
    { key: "list_final_invoices", service: service.list, describe: "List final invoices (filter status/client)." },
    { key: "get_final_invoice", service: service.get, describe: "Get a final invoice by id, with its lines." },
  ],
  writes: [
    { key: "draft_final_invoice", service: service.createDraft, schema: validator.schemas.createDraft, permission: { module: "MOD-51", action: "create" }, confirm: true, describe: "Create a DRAFT final invoice (no GL yet)." },
    { key: "update_final_invoice", service: (c, p) => service.updateDraft(c, { invoiceId: p.invoice_id, patch: { client_id: p.client_id, dossier_id: p.dossier_id }, lines: p.lines || null }), schema: validator.schemas.aiUpdate, permission: { module: "MOD-51", action: "edit" }, confirm: true, describe: "Edit a DRAFT final invoice by id." },
    { key: "submit_final_invoice", service: (c, p) => service.submit(c, { invoiceId: p.invoice_id, entryDate: p.entry_date, sourceDocRef: p.source_doc_ref }), schema: validator.schemas.aiSubmit, permission: { module: "MOD-51", action: "approve" }, confirm: true, describe: "Submit a final invoice by id; auto-posts (revenue+débours+VAT, clears advance, numbers + captures the doc) when no workflow is bound. KB §8.3." },
  ],
};
