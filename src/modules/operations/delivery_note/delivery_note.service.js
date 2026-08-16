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
const { AppError } = require("../../../utils/errors");

const ref = (id) => "delivery_note:" + id;

async function create(client, {
  entityId, dossierId = null, consignee = null, cityZone = null, contactPerson = null,
  address = null, phone = null, deliveryDate = null, lines = [], date = null, actor = {},
}) {
  await client.query("BEGIN");
  try {
    const { number } = await numbering.allocate(client, { moduleKey: events.MODULE, entityId, date: date || new Date().toISOString().slice(0, 10) });
    const dn = await repo.insertDN(client, {
      dossier_id: dossierId, doc_number: number, consignee, city_zone: cityZone,
      contact_person: contactPerson, address, phone, delivery_date: deliveryDate,
    });
    // G23 — the same defect fixed in transit_order.replaceLines.
    //
    // This used to be `if (!l.inventory_item_id) continue`, which meant a line
    // the user typed by hand ("2 pallets, unlisted spares") was dropped without
    // a word: 201 Created, note printed, line gone. A delivery note is a legal
    // proof of what was handed over, so silently shortening its contents is the
    // worst possible failure mode — it is invisible at exactly the moment it
    // matters, which is the delivery dispute months later.
    //
    // A line IS its label; the stock link is optional decoration. So insert on
    // `label`, and REFUSE a line that has neither rather than skipping it. The
    // index is named so the operator knows which row to fix.
    const rows = (lines || []).filter(Boolean);
    for (let i = 0; i < rows.length; i += 1) {
      const l = rows[i];
      const label = typeof l.label === "string" ? l.label.trim() : "";
      if (!label && !l.inventory_item_id) {
        throw new AppError("VALIDATION_ERROR", `Line ${i + 1} needs a description.`, 422, {
          [`lines.${i}.label`]: ["a line needs a description (or a stock item)"],
        });
      }
      await repo.insertLine(client, {
        delivery_note_id: dn.delivery_note_id,
        inventory_item_id: l.inventory_item_id || null,
        label: label || null,
        qty: Number(l.qty) || 1,
      });
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
