"use strict";
const service = require("./purchase_request.service");
const validator = require("./purchase_request.validator");
module.exports = {
  entity: "purchase_request", module_key: "MOD-62", screens: [],
  reads: [
    { key: "list_purchase_requests", service: service.list, describe: "List purchase requests." },
    { key: "get_purchase_request", service: service.get, describe: "Get a purchase request by id." },
  ],
  writes: [
    { key: "create_purchase_request", service: service.createDraft, schema: validator.schemas.create, permission: { module: "MOD-62", action: "create" }, confirm: true, describe: "Create a DRAFT purchase requisition." },
    { key: "transition_purchase_request", service: (c, p) => service.transition(c, { id: p.purchase_request_id, to: p.to, entityId: p.entity_id, date: p.date }), schema: validator.schemas.aiTransition, permission: { module: "MOD-62", action: "approve" }, confirm: true, describe: "Submit/approve/reject/order a requisition by id." },
  ],
};
