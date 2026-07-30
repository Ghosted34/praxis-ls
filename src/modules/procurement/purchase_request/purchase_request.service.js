/**
 * Purchase request (MOD-62) — the requisition that precedes a PO.
 * Lifecycle: createDraft → submit → approve/reject → (PO creation marks ORDERED).
 * Numbered + captured on submit. All SQL is in the repo.
 */
"use strict";

const repo = require("./purchase_request.repo");
const events = require("./purchase_request.events");
const { assertTransition } = require("./purchase_request.rules");
const numbering = require("../../../services/documents/numbering.service");
const documents = require("../../../services/documents/document.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "purchase_request:" + id;

async function createDraft(client, { requestedBy = null, department = null, justification = null, lines = [], actor = {} }) {
  await client.query("BEGIN");
  try {
    const pr = await repo.insertPR(client, { requested_by: requestedBy || actor.user_id || null, department, justification, status: "DRAFT" });
    for (const l of lines || []) {
      if (!l || !l.label) continue;
      await repo.insertLine(client, { pr_id: pr.pr_id, label: l.label, qty: Number(l.qty) || 1, unit_price: Number(l.unit_price) || 0 });
    }
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(pr.pr_id), after: pr });
    await client.query("COMMIT");
    return pr;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function transition(client, { id, to, entityId = null, date = null, actor = {} }) {
  const pr = await repo.getPR(client, id);
  if (!pr) throw new AppError("NOT_FOUND", "Purchase request not found", 404);
  assertTransition(pr.status, to);
  await client.query("BEGIN");
  try {
    let updated = await repo.setStatus(client, id, to);
    if (to === "SUBMITTED" && !pr.doc_number && entityId) {
      const { number } = await numbering.allocate(client, { moduleKey: events.MODULE, entityId, date: date || new Date().toISOString().slice(0, 10) });
      updated = await repo.setDocNumber(client, id, number);
      await documents.capture(client, { entityRef: ref(id), docType: "PURCHASE_REQUEST", status: "DRAFT" });
    }
    await emitEvent(client, { eventTypeKey: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), after: updated });
    await client.query("COMMIT");
    return updated;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

const get = (client, id) => repo.getPR(client, id);
const list = (client, q) => repo.listPR(client, q);

module.exports = { createDraft, transition, get, list };
