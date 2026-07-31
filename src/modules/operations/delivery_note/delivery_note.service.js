/**
 * Delivery note (MOD-32) — proof-of-delivery document on a dossier.
 * Numbered (doc_number) + captured on create. All SQL is in the repo.
 */
"use strict";

const repo = require("./delivery_note.repo");
const events = require("./delivery_note.events");
const numbering = require("../../../services/documents/numbering.service");
const documents = require("../../../services/documents/document.service");
const { emitEvent, audit } = require("../../../shared/events/emit");

const ref = (id) => "delivery_note:" + id;

async function create(client, { entityId, dossierId = null, consignee = null, cityZone = null, contactPerson = null, lines = [], date = null, actor = {} }) {
  await client.query("BEGIN");
  try {
    const { number } = await numbering.allocate(client, { moduleKey: events.MODULE, entityId, date: date || new Date().toISOString().slice(0, 10) });
    const dn = await repo.insertDN(client, { dossier_id: dossierId, doc_number: number, consignee, city_zone: cityZone, contact_person: contactPerson });
    for (const l of lines || []) {
      if (!l || !l.inventory_item_id) continue;
      await repo.insertLine(client, { delivery_note_id: dn.delivery_note_id, inventory_item_id: l.inventory_item_id, label: l.label || null, qty: Number(l.qty) || 1 });
    }
    await documents.capture(client, { entityRef: ref(dn.delivery_note_id), docType: "DELIVERY_NOTE", status: "VERIFIED" });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(dn.delivery_note_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(dn.delivery_note_id), after: dn });
    await client.query("COMMIT");
    return dn;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

const get = (client, id) => repo.getDN(client, id);
const list = (client, q) => repo.listDN(client, q);

module.exports = { create, get, list };
