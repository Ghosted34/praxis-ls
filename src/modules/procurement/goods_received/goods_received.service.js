/**
 * Goods Received Note (MOD-61, KB §8.5) — records physical receipt against a PO.
 * Creating a GRN advances the PO to RECEIVED (through the PO service, so its
 * lifecycle rules apply). The three-way-match flag is set later when the supplier
 * invoice reconciles PR↔PO↔GRN↔invoice. All SQL is in the repo.
 *
 * 10720: the GRN now carries RECEIVED LINES (ordered / received / condition), a
 * document number of its own (sequence MOD-33 "GRN", never the SIN counter), and
 * is captured to the vault as GOODS_RECEIVED — so a partial delivery is recorded
 * and printed, and the match can compare quantities, not just totals.
 */
"use strict";

const repo = require("./goods_received.repo");
const events = require("./goods_received.events");
const poService = require("../purchase_order/purchase_order.service");
const numbering = require("../../../services/documents/numbering.service");
const documents = require("../../../services/documents/document.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "goods_received_note:" + id;

async function replaceLines(client, grnId, lines) {
  await repo.deleteLines(client, grnId);
  for (const l of lines || []) {
    if (!l || !l.label && !l.dictionary_item_id) continue;
    /// eslint-disable-next-line no-await-in-loop
    await repo.insertLine(client, {
      grn_id: grnId,
      dictionary_item_id: l.dictionary_item_id || null,
      label: l.label || "Item",
      ordered: l.ordered !== undefined ? Number(l.ordered) || 0 : 0,
      received: l.received !== undefined ? Number(l.received) || 0 : (l.ordered !== undefined ? Number(l.ordered) || 0 : 0),
      condition: l.condition || null,
    });
  }
}

async function record(client, { poId, receivedBy = null, supplierInvoiceRef = null, entityId = null, date = null, lines = [], note = null, actor = {} }) {
  const po = await repo.poStatus(client, poId);
  if (!po) throw new AppError("NOT_FOUND", "Purchase order not found", 404);
  if (!["APPROVED_LOCKED", "RECEIVED"].includes(po.status)) {
    throw new AppError("PO_NOT_RECEIVABLE", "PO must be APPROVED_LOCKED before goods can be received (is " + po.status + ")", 422);
  }
  await client.query("BEGIN");
  try {
    const grn = await repo.insertGRN(client, { po_id: poId, received_by: receivedBy || actor.user_id || null, supplier_invoice_ref: supplierInvoiceRef, three_way_matched: false, received_on: date || null, note });
    await replaceLines(client, grn.grn_id, lines);
    // 10721: the entity defaults to the PO's own — a GRN without one can no
    // longer slip through and print a truncated UUID instead of a number.
    const effEntity = entityId || po.entity_id || null;
    if (effEntity) {
      const { number } = await numbering.allocate(client, { moduleKey: events.NUMBERING_KEY, entityId: effEntity, date: date || new Date().toISOString().slice(0, 10) });
      await repo.update(client, grn.grn_id, { doc_number: number, entity_id: effEntity });
    }
    if (po.status === "APPROVED_LOCKED") await poService.transition(client, { poId, to: "RECEIVED", entityId, date, actor });
    // Captured under its own doc type so the vault row, the template and the
    // RBAC gate all agree (document_vault.types asserts the code).
    await documents.capture(client, { entityRef: ref(grn.grn_id), docType: "GOODS_RECEIVED", status: "VERIFIED" });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(grn.grn_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(grn.grn_id), after: grn });
    await client.query("COMMIT");
    return get(client, grn.grn_id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function get(client, id) {
  const grn = await repo.getGRN(client, id);
  if (!grn) return null;
  grn.lines = await repo.listLines(client, id);
  grn.wms_inbound = await repo.wmsInboundForGRN(client, id);
  return grn;
}
const list = (client, q) => repo.listGRN(client, q);
const markMatched = (client, id, matched) => repo.update(client, id, { three_way_matched: matched === true });
const listLines = (client, id) => repo.listLines(client, id);

/**
 * Hand a procurement GRN to the warehouse (10721, the full bridge the user
 * chose): creates the WMS inbound (grn_inbound, QA HOLD) carrying the received
 * lines, and links it back on goods_received_note.wms_inbound_id. One GRN is
 * sent once; the warehouse operator then QA's and putaways the inbound as
 * usual. The lines copy item labels / quantities / conditions — the WMS
 * resolves inventory items during QA.
 */
async function sendToWarehouse(client, { id, actor = {} }) {
  const grn = await repo.getGRN(client, id);
  if (!grn) throw new AppError("NOT_FOUND", "GRN not found", 404);
  if (grn.wms_inbound_id) throw new AppError("ALREADY_SENT", "This GRN has already been sent to the warehouse", 409);
  const po = await repo.poStatus(client, grn.po_id);
  const lines = await repo.listLines(client, id);
  if (!lines.length) throw new AppError("NO_LINES", "A GRN needs received lines before it can be sent to the warehouse", 422);

  await client.query("BEGIN");
  try {
    const { rows } = await client.query(
      `INSERT INTO grn_inbound (dossier_id, po_id, source_grn_id, qa_status)
       VALUES ($1, $2, $3, 'HOLD') RETURNING *`,
      [po && po.dossier_id ? po.dossier_id : null, grn.po_id, id],
    );
    const inbound = rows[0];
    for (const l of lines) {
      /// eslint-disable-next-line no-await-in-loop
      await client.query(
        `INSERT INTO grn_line (grn_inbound_id, item, ordered, received, condition)
         VALUES ($1, $2, $3, $4, $5)`,
        [inbound.grn_inbound_id, l.label, l.ordered, l.received, l.condition],
      );
    }
    const updated = await repo.update(client, id, { wms_inbound_id: inbound.grn_inbound_id });
    await emitEvent(client, { eventTypeKey: "goods_received.sent_to_warehouse", moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null, payload: { wms_inbound_id: inbound.grn_inbound_id, line_count: lines.length } });
    await audit(client, { actorUserId: actor.user_id || null, action: "goods_received.sent_to_warehouse", moduleKey: events.MODULE, entityRef: ref(id), after: { wms_inbound_id: inbound.grn_inbound_id, line_count: lines.length } });
    await client.query("COMMIT");
    return { ...updated, wms_inbound: inbound, line_count: lines.length };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

module.exports = { record, get, list, markMatched, listLines, sendToWarehouse };
