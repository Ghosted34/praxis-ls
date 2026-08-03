"use strict";
const service = require("./transit_order.service");
const validator = require("./transit_order.validator");
module.exports = {
  entity: "transit_order", module_key: "MOD-30", screens: [],
  reads: [
    { key: "list_transit_orders", service: service.list, describe: "List transit orders." },
    { key: "get_transit_order", service: service.get, describe: "Get a transit order by id." },
  ],
  writes: [
    { key: "create_transit_order", service: service.create, schema: validator.schemas.create, permission: { module: "MOD-30", action: "create" }, confirm: true, describe: "Create a numbered transit order on a dossier." },
    { key: "update_transit_order_docs", service: (c, p) => service.updateDocs(c, { transitOrderId: p.transit_order_id, submittedDocs: p.submitted_docs }), schema: validator.schemas.aiUpdate, permission: { module: "MOD-30", action: "edit" }, confirm: true, describe: "Update submitted documents on a transit order by id." },
  ],
};
