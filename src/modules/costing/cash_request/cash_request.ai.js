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
    { key: "disburse_cash_request", service: service.disburse, schema: validator.schemas.disburse, permission: { module: "MOD-49", action: "approve" }, confirm: true, describe: "Disburse (issues a régie advance, Dr 581 / Cr treasury)." },
    { key: "justify_cash_request", service: service.justify, schema: validator.schemas.justify, permission: { module: "MOD-49", action: "edit" }, confirm: true, describe: "Record spend and close (JUSTIFIED)." },
  ],
};
