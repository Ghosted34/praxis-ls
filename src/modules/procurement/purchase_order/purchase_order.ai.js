"use strict";
const service = require("./purchase_order.service");
const validator = require("./purchase_order.validator");
module.exports = {
  entity: "purchase_order", module_key: "MOD-60", screens: [],
  reads: [
    { key: "list_purchase_orders", service: service.list, describe: "List purchase orders." },
    { key: "get_purchase_order", service: service.get, describe: "Get a purchase order with items." },
  ],
  writes: [
    { key: "draft_purchase_order", service: service.createDraft, schema: validator.schemas.create, permission: { module: "MOD-60", action: "create" }, confirm: true, describe: "Create a DRAFT purchase order." },
    { key: "update_purchase_order", service: (c, p) => service.updateDraft(c, { poId: p.purchase_order_id, items: p.items || null, patch: { supplier_id: p.supplier_id, dossier_id: p.dossier_id, expense_category: p.expense_category } }), schema: validator.schemas.aiUpdate, permission: { module: "MOD-60", action: "edit" }, confirm: true, describe: "Edit a DRAFT purchase order by id." },
    { key: "transition_purchase_order", service: (c, p) => service.transition(c, { poId: p.purchase_order_id, to: p.to, entityId: p.entity_id, date: p.date }), schema: validator.schemas.aiTransition, permission: { module: "MOD-60", action: "approve" }, confirm: true, describe: "Advance a PO by id one step along DRAFT→ISSUED_LOCKED→APPROVED_LOCKED→RECEIVED→CLOSED (CANCELLED from DRAFT or ISSUED_LOCKED). Cannot skip states; numbers on issue." },
  ],
};
