/**
 * Transit order (MOD-30) — the customs/forwarding instruction on a dossier.
 * Numbered (ot_number) + captured on create; submitted_docs can be appended.
 * All SQL is in the repo.
 */
"use strict";

const repo = require("./transit_order.repo");
const events = require("./transit_order.events");
const numbering = require("../../../services/documents/numbering.service");
const documents = require("../../../services/documents/document.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "transit_order:" + id;

async function create(client, { entityId, dossierId = null, customsRegime = null, serviceDirection = null, declaredValue = null, submittedDocs = [], lines = [], date = null, actor = {} }) {
  await client.query("BEGIN");
  try {
    const { number } = await numbering.allocate(client, { moduleKey: events.MODULE, entityId, date: date || new Date().toISOString().slice(0, 10) });
    const to = await repo.insertTO(client, { dossier_id: dossierId, ot_number: number, customs_regime: customsRegime, service_direction: serviceDirection, declared_value: declaredValue, submitted_docs: JSON.stringify(submittedDocs) });
    for (const l of lines || []) {
      if (!l || !l.inventory_item_id) continue;
      await repo.insertLine(client, { transit_order_id: to.transit_order_id, inventory_item_id: l.inventory_item_id, label: l.label || null, packages: Number(l.packages) || 1, weight: l.weight || null });
    }
    await documents.capture(client, { entityRef: ref(to.transit_order_id), docType: "TRANSIT_ORDER", status: "VERIFIED" });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(to.transit_order_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(to.transit_order_id), after: to });
    await client.query("COMMIT");
    return to;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function updateDocs(client, { transitOrderId, submittedDocs, actor = {} }) {
  const to = await repo.getTO(client, transitOrderId);
  if (!to) throw new AppError("NOT_FOUND", "Transit order not found", 404);
  await client.query("BEGIN");
  try {
    const updated = await repo.update(client, transitOrderId, { submitted_docs: JSON.stringify(submittedDocs) });
    await documents.capture(client, { entityRef: ref(transitOrderId), docType: "TRANSIT_ORDER", status: "VERIFIED" });
    await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(transitOrderId), after: updated });
    await client.query("COMMIT");
    return updated;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

const get = (client, id) => repo.getTO(client, id);
const list = (client, q) => repo.listTO(client, q);

module.exports = { create, updateDocs, get, list };
