"use strict";
const service = require("./smart_receivables.service");
const validator = require("./smart_receivables.validator");
module.exports = {
  entity: "payment_receipt", module_key: "MOD-52", screens: [],
  reads: [
    { key: "list_receipts", service: service.list, describe: "List customer receipts." },
    { key: "get_receipt", service: service.get, describe: "Get a receipt with its allocations." },
    { key: "receivables_ageing", service: service.ageing, describe: "Ageing report (0/1-30/31-60/61-90/90+)." },
    { key: "receivables_reminders", service: service.reminders, describe: "Dunning plan for overdue invoices." },
  ],
  writes: [
    { key: "draft_receipt", service: (c, p) => service.createDraft(c, { clientId: p.client_id, method: p.method, treasuryAccountId: p.treasury_account_id, amount: p.amount, receivedOn: p.received_on }), schema: validator.schemas.create, permission: { module: "MOD-52", action: "create" }, confirm: true, describe: "Record a DRAFT customer receipt." },
    { key: "post_receipt", service: (c, p) => service.post(c, { receiptId: p.receipt_id, entityId: p.entity_id, entryDate: p.entry_date, sourceDocRef: p.source_doc_ref, customerAccount: p.customer_account }), schema: validator.schemas.aiPost, permission: { module: "MOD-52", action: "approve" }, confirm: true, describe: "Post a receipt by id (Dr cash / Cr 4111), FIFO-allocate to open invoices." },
  ],
};
