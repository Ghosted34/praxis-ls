"use strict";
const service = require("./supplier_invoice.service");
const validator = require("./supplier_invoice.validator");
module.exports = {
  entity: "supplier_invoice", module_key: "MOD-61", screens: [],
  reads: [
    { key: "list_supplier_invoices", service: service.list, permission: { module: "MOD-61", action: "view" }, describe: "List supplier invoices." },
    { key: "get_supplier_invoice", service: service.get, permission: { module: "MOD-61", action: "view" }, describe: "Get a supplier invoice with lines." },
  ],
  writes: [
    { key: "draft_supplier_invoice", service: service.createDraft, schema: validator.schemas.create, permission: { module: "MOD-61", action: "create" }, confirm: true, describe: "Create a DRAFT supplier invoice." },
    { key: "match_supplier_invoice", service: service.match, schema: validator.schemas.match, permission: { module: "MOD-61", action: "edit" }, confirm: true, describe: "Run the three-way match (PR↔PO↔GRN↔invoice)." },
    { key: "post_supplier_invoice", service: (c, p) => service.post(c, { supplierInvoiceId: p.supplier_invoice_id, entryDate: p.entry_date, sourceDocRef: p.source_doc_ref, supplierAccount: p.supplier_account }), schema: validator.schemas.aiPost, permission: { module: "MOD-61", action: "approve" }, confirm: true, describe: "Post a supplier invoice by id to GL (Dr expense+VAT / Cr supplier net of WHT + WHT). KB §8.5." },
    { key: "pay_supplier_invoice", service: (c, p) => service.pay(c, { supplierInvoiceId: p.supplier_invoice_id, amount: p.amount, entityId: p.entity_id, entryDate: p.entry_date, treasuryAccountId: p.treasury_account_id, note: p.note }), schema: validator.schemas.aiPay, permission: { module: "MOD-61", action: "approve" }, confirm: true, describe: "Pay a posted supplier invoice by id (Dr 4011 / Cr treasury, KB §8.5). Amount defaults to the full outstanding balance." },
    { key: "reverse_supplier_invoice", service: (c, p) => service.reverse(c, { supplierInvoiceId: p.supplier_invoice_id, reason: p.reason, entryDate: p.entry_date }), schema: validator.schemas.aiReverse, permission: { module: "MOD-61", action: "approve" }, confirm: true, describe: "Reverse a POSTED_LOCKED or PAID supplier invoice: contra entries for the posting and any payments, status REVERSED." },
  ],
};
