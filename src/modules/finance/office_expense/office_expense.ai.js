"use strict";
const service = require("./office_expense.service");
const validator = require("./office_expense.validator");
module.exports = {
  entity: "office_expense", ai_writes: false, module_key: "MOD-77", screens: [],
  reads: [
    { key: "list_office_expenses", service: service.list, permission: { module: "MOD-77", action: "view" }, describe: "List office expenses (rent, utilities, supplies…), filterable by status/category/date." },
    { key: "get_office_expense", service: service.get, permission: { module: "MOD-77", action: "view" }, describe: "Get one office expense with its posting state." },
  ],
  writes: [
    // 3-arg wrappers so the executor's actor lands in the audit trail (ai-write-contract ratchet, audit C4).
    { key: "create_office_expense", service: (c, p, actor) => service.create(c, { data: p, actor }), schema: validator.schemas.create, permission: { module: "MOD-77", action: "create" }, confirm: true, describe: "Record an office running cost as a DRAFT expense." },
    { key: "post_office_expense", service: (c, p, actor) => service.post(c, { id: p.expense_id, entryDate: p.entry_date, paidVia: p.paid_via, creditCoa: p.credit_coa, sourceDocRef: p.source_doc_ref, actor }), schema: validator.schemas.aiPost, permission: { module: "MOD-77", action: "approve" }, confirm: true, describe: "Post a draft office expense to the ledger (by expense id): Dr expense account / Cr treasury or cash." },
  ],
};
