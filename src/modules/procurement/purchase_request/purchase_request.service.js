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
const executor = require("../../../services/workflow/executor");
const onApproved = require("../../../services/workflow/on-approved");
const { assertNoPendingChain } = require("../../../services/workflow/pending-guard");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "purchase_request:" + id;

async function createDraft(client, { requestedBy = null, department = null, scopeId = null, justification = null, lines = [], actor = {} }) {
  await client.query("BEGIN");
  try {
    // scope_id is the department reference; `department` rides along as the
    // display snapshot documents print (0490, same pattern as line-item labels).
    const pr = await repo.insertPR(client, { requested_by: requestedBy || actor.user_id || null, department, scope_id: scopeId, justification, status: "DRAFT" });
    for (const l of lines || []) {
      if (!l || !l.dictionary_item_id) continue;
      await repo.insertLine(client, { pr_id: pr.pr_id, dictionary_item_id: l.dictionary_item_id, label: l.label || null, qty: Number(l.qty) || 1, unit_price: Number(l.unit_price) || 0 });
    }
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(pr.pr_id), after: pr });
    await client.query("COMMIT");
    return pr;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function transition(client, { id, to, entityId = null, date = null, actor = {}, viaChain = false }) {
  const pr = await repo.getPR(client, id);
  if (!pr) throw new AppError("NOT_FOUND", "Purchase request not found", 404);
  assertTransition(pr.status, to);
  // Deciding directly while a chain is live would skip it (W4). Before BEGIN so
  // the refusal doesn't open and roll back a transaction.
  if (to === "APPROVED" || to === "REJECTED") {
    await assertNoPendingChain(client, ref(id), { viaChain, what: "purchase request" });
  }
  await client.query("BEGIN");
  try {
    let updated = await repo.setStatus(client, id, to);
    if (to === "SUBMITTED" && !pr.doc_number && entityId) {
      const { number } = await numbering.allocate(client, { moduleKey: events.MODULE, entityId, date: date || new Date().toISOString().slice(0, 10) });
      updated = await repo.setDocNumber(client, id, number);
      await documents.capture(client, { entityRef: ref(id), docType: "PURCHASE_REQUEST", status: "PENDING" });
    }
    if (to === "SUBMITTED") {
      // Open the tenant's configurable approval chain (bound to pr.submitted,
      // registered in 0491). A purchase request is literally a request for
      // approval to buy something, and this module was the only such document
      // that never opened a chain — it had APPROVED/REJECTED states and an
      // "Approved" KPI, but submitting notified nobody and created no task.
      //
      // Amount is the sum of the request's lines, so threshold routing works the
      // same way it does for a PO. Null when there are no lines, which — since
      // W10 — means "needs the most scrutiny", not "skip approval".
      const lines = await repo.listLines(client, id);
      const total = lines.reduce((n, l) => n + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);
      await executor.start(client, {
        eventTypeKey: "pr.submitted",
        entityRef: ref(id),
        amountXaf: lines.length ? total : null,
        actorUserId: actor.user_id || null,
      });
    }
    await emitEvent(client, { eventTypeKey: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), after: updated });
    await client.query("COMMIT");
    return updated;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

const get = (client, id) => repo.getPR(client, id);
// scopeIds threads the caller's organigramme closure through to the repo, which
// narrows the list to their part of the company (audit finding A2). Null =
// unrestricted, which is every caller with no scope assignment.
const list = (client, q, scopeIds = null) => repo.listPR(client, q, scopeIds);

// A cleared approval chain approves the request (BUILD_CONVENTIONS §2/§5), and a
// rejected one rejects it — so the central Approvals inbox and the procurement
// queue can't disagree about the same document.
onApproved.register("purchase_request", (client, { id, actor }) =>
  transition(client, { id, to: "APPROVED", actor: actor || {}, viaChain: true }));
onApproved.registerReject("purchase_request", (client, { id, actor }) =>
  transition(client, { id, to: "REJECTED", actor: actor || {}, viaChain: true }));

module.exports = { createDraft, transition, get, list };
