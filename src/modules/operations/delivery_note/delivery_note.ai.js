"use strict";
const service = require("./delivery_note.service");
const validator = require("./delivery_note.validator");

module.exports = {
  entity: "delivery_note", module_key: "MOD-32", screens: [],
  reads: [
    { key: "list_delivery_notes", service: service.list, permission: { module: "MOD-32", action: "view" }, describe: "List delivery notes. Filter by dossier_id, status (CSV) or q (number, file ref, consignee, who signed)." },
    { key: "get_delivery_note", service: service.get, permission: { module: "MOD-32", action: "view" }, describe: "Get a delivery note with its cargo lines, containers and allowed transitions." },
    { key: "delivery_note_summary", service: service.summary, permission: { module: "MOD-32", action: "view" }, describe: "Count delivery notes by status, for the KPI tiles." },
  ],
  writes: [
    { key: "create_delivery_note", service: service.create, schema: validator.schemas.create, permission: { module: "MOD-32", action: "create" }, confirm: true, describe: "Draft a delivery note on an operations file. No number is allocated until it is issued." },
    { key: "issue_delivery_note", service: service.issue, schema: validator.schemas.issue, permission: { module: "MOD-32", action: "create" }, confirm: true, describe: "Allocate the number, snapshot the shipment details and capture the PDF." },
    { key: "confirm_delivery", service: service.confirmDelivery, schema: validator.schemas.deliver, permission: { module: "MOD-32", action: "edit" }, confirm: true, describe: "Record who received the goods, when, and any reservations they noted." },
  ],
};
