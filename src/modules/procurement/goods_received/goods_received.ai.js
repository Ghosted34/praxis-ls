"use strict";
const service = require("./goods_received.service");
const validator = require("./goods_received.validator");
module.exports = {
  entity: "goods_received_note", module_key: "MOD-61", screens: [],
  reads: [
    { key: "list_goods_received", service: service.list, permission: { module: "MOD-61", action: "view" }, describe: "List goods-received notes." },
    { key: "get_goods_received", service: service.get, permission: { module: "MOD-61", action: "view" }, describe: "Get a GRN by id." },
  ],
  writes: [
    { key: "record_goods_received", service: service.record, schema: validator.schemas.create, permission: { module: "MOD-61", action: "create" }, confirm: true, describe: "Record receipt against a PO (advances PO to RECEIVED)." },
    { key: "send_goods_received_to_warehouse", service: (c, p) => service.sendToWarehouse(c, { id: p.grn_id }), schema: validator.schemas.aiSendToWarehouse, permission: { module: "MOD-61", action: "edit" }, confirm: true, describe: "Hand a GRN to the warehouse: creates the WMS inbound (QA HOLD) with the received lines, links it back. Once per GRN." },
  ],
};
