"use strict";
const service = require("./cash_request.service");
const validator = require("./cash_request.validator");
module.exports = {
  entity: "cash_request", module_key: "MOD-49", screens: [],
  reads: [
    { key: "list_cash_requests", service: service.list, permission: { module: "MOD-49", action: "view" }, describe: "List cash requests / disbursals." },
    { key: "get_cash_request", service: service.get, permission: { module: "MOD-49", action: "view" }, describe: "Get a cash request with lines + payments." },
  ],
  writes: [
    { key: "draft_cash_request", service: service.createDraft, schema: validator.schemas.create, permission: { module: "MOD-49", action: "create" }, confirm: true, describe: "Create a DRAFT cash request." },
    { key: "update_cash_request", service: (c, p) => service.updateDraft(c, { id: p.cash_request_id, lines: p.lines || null }), schema: validator.schemas.aiUpdate, permission: { module: "MOD-49", action: "edit" }, confirm: true, describe: "Edit a DRAFT cash request by id." },
    { key: "transition_cash_request", service: (c, p) => service.transition(c, { id: p.cash_request_id, to: p.to, entityId: p.entity_id, date: p.date }), schema: validator.schemas.aiTransition, permission: { module: "MOD-49", action: "approve" }, confirm: true, describe: "Advance a cash request by id one step along DRAFT→SUBMITTED→APPROVED (REJECTED from SUBMITTED or APPROVED); disburse/justify are separate actions. Cannot skip states." },
    { key: "disburse_cash_request", service: (c, p) => service.disburse(c, { id: p.cash_request_id, amount: p.amount === undefined ? null : p.amount, entityId: p.entity_id, entryDate: p.entry_date, sourceDocRef: p.source_doc_ref, treasuryAccountId: p.treasury_account_id || null, holderUserId: p.holder_user_id, memo: p.memo || null }), schema: validator.schemas.aiDisburse, permission: { module: "MOD-49", action: "approve" }, confirm: true, describe: "Disburse a cash request by id, in full or as one instalment (issues a régie advance, Dr 581 / Cr treasury). Omit amount to pay the whole outstanding balance." },
    { key: "justify_cash_request", service: (c, p) => service.justify(c, { id: p.cash_request_id, lines: p.lines, entityId: p.entity_id, entryDate: p.entry_date }), schema: validator.schemas.aiJustify, permission: { module: "MOD-49", action: "edit" }, confirm: true, describe: "Record spend, retire the linked régie advance (Dr 4731 / Cr 581) and close the request (JUSTIFIED)." },
  ],
};
