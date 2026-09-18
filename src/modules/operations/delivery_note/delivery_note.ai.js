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
    { key: "create_delivery_note", service: (c, p, actor) => service.create(c, { entityId: p.entity_id, dossierId: p.dossier_id, consignee: p.consignee, cityZone: p.city_zone, contactPerson: p.contact_person, address: p.address, phone: p.phone, deliveryDate: p.delivery_date || p.date, lines: p.lines, containers: p.containers, actor }), schema: validator.schemas.create, permission: { module: "MOD-32", action: "create" }, confirm: true, describe: "Draft a delivery note on an operations file. No number is allocated until it is issued." },
    { key: "issue_delivery_note", service: (c, p, actor) => service.issue(c, { id: p.delivery_note_id, actor }), schema: validator.schemas.aiIssue, permission: { module: "MOD-32", action: "create" }, confirm: true, describe: "Allocate the number, snapshot the shipment details and capture the PDF." },
    { key: "confirm_delivery", service: (c, p, actor) => service.confirmDelivery(c, { id: p.delivery_note_id, receivedByName: p.received_by_name, receivedAt: p.received_at, reservations: p.reservations, signatureVaultId: p.signature_vault_id, actor }), schema: validator.schemas.aiDeliver, permission: { module: "MOD-32", action: "edit" }, confirm: true, describe: "Record who received the goods, when, and any reservations they noted." },
  ],
};
