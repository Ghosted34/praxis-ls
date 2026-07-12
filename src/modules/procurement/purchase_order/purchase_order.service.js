/**
 * Purchase order (MOD-60, KB §8.5) — created from an approved PR or standalone.
 * Lifecycle: createDraft → updateDraft → issue (number+lock+capture) → approve →
 * receive (a GRN records receipt) → close. Numbered + captured on issue.
 * All SQL is in the repo.
 */
"use strict";

const repo = require("./purchase_order.repo");
const events = require("./purchase_order.events");
const { assertTransition, computeTotal } = require("./purchase_order.rules");
const numbering = require("../../../services/documents/numbering.service");
const documents = require("../../../services/documents/document.service");
const executor = require("../../../services/workflow/executor");
const onApproved = require("../../../services/workflow/on-approved");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "purchase_order:" + id;

async function replaceItems(client, poId, items) {
  await repo.deleteItems(client, poId);
  for (const it of items) {
    /// eslint-disable-next-line no-await-in-loop
    await repo.insertItem(client, { po_id: poId, dictionary_item_id: it.dictionary_item_id || null, label: it.label || "Item", qty: it.qty || 1, unit_price: it.unit_price || 0 });
  }
}

async function createDraft(client, { prId = null, supplierId = null, dossierId = null, expenseCategory = "OPERATIONS", items = [], actor = {} }) {
  await client.query("BEGIN");
  try {
    const po = await repo.insertPO(client, { pr_id: prId, supplier_id: supplierId, dossier_id: dossierId, expense_category: expenseCategory, status: "DRAFT", issuer_id: actor.user_id || null });
    if (items.length) { await replaceItems(client, po.po_id, items); await repo.update(client, po.po_id, { total_ttc: computeTotal(items) }); }
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(po.po_id), after: po });
    await client.query("COMMIT");
    return get(client, po.po_id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function updateDraft(client, { poId, items = null, patch = {}, actor = {} }) {
  const po = await repo.getPO(client, poId);
  if (!po) throw new AppError("NOT_FOUND", "Purchase order not found", 404);
  if (po.status !== "DRAFT") throw new AppError("LOCKED", "Only a DRAFT purchase order can be edited", 422);
  await client.query("BEGIN");
  try {
    const fields = {};
    for (const k of ["supplier_id", "dossier_id", "expense_category"]) if (patch[k] !== undefined) fields[k] = patch[k];
    if (Array.isArray(items)) { await replaceItems(client, poId, items); fields.total_ttc = computeTotal(items); }
    if (Object.keys(fields).length) await repo.update(client, poId, fields);
    await client.query("COMMIT");
    return get(client, poId);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function transition(client, { poId, to, entityId = null, date = null, actor = {} }) {
  const po = await repo.getPO(client, poId);
  if (!po) throw new AppError("NOT_FOUND", "Purchase order not found", 404);
  assertTransition(po.status, to);
  await client.query("BEGIN");
  try {
    const fields = { status: to };
    if (to === "ISSUED_LOCKED" && !po.doc_number) {
      if (!entityId) throw new AppError("ENTITY_REQUIRED", "entity_id required to issue (number allocation)", 422);
      const { number } = await numbering.allocate(client, { moduleKey: events.MODULE, entityId, date: date || new Date().toISOString().slice(0, 10) });
      fields.doc_number = number;
    }
    if (to === "APPROVED_LOCKED") fields.approver_id = actor.user_id || null;
    const updated = await repo.update(client, poId, fields);
    if (to === "ISSUED_LOCKED") {
      await documents.capture(client, { entityRef: ref(poId), docType: "PURCHASE_ORDER", status: "VERIFIED" });
      // Open the tenant's configurable approval chain on issue (bound to po.issued).
      // No workflow bound → autoApproved; the manual APPROVED_LOCKED path is unchanged.
      await executor.start(client, { eventTypeKey: "po.issued", entityRef: ref(poId), amountXaf: updated.total_ttc === null || updated.total_ttc === undefined ? null : Number(updated.total_ttc) });
    }
    await emitEvent(client, { eventTypeKey: events.transition(to), moduleKey: events.MODULE, entityRef: ref(poId), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.transition(to), moduleKey: events.MODULE, entityRef: ref(poId), after: updated });
    await client.query("COMMIT");
    return updated;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function get(client, id) {
  const po = await repo.getPO(client, id);
  if (!po) return null;
  po.items = await repo.listItems(client, id);
  return po;
}
const list = (client, q) => repo.listPO(client, q);

// A cleared approval chain approves+locks the issued PO (BUILD_CONVENTIONS §2/§5).
onApproved.register("purchase_order", (client, { id, actor }) => transition(client, { poId: id, to: "APPROVED_LOCKED", actor: actor || {} }));

module.exports = { createDraft, updateDraft, transition, get, list };
