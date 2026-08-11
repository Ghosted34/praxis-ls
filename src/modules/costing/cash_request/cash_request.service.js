/**
 * Cash request / project disbursal document (MOD-49, KB §6.8) — the requisition
 * that precedes a régie d'avance. Lifecycle: createDraft → submit (number+capture)
 * → approve/reject → disburse (issues a régie advance = the ledger side) → justify
 * (record spend). The GL posting lives in the régie module; this document links to
 * it via regie_advance_id. All SQL is in the repo.
 */
"use strict";

const repo = require("./cash_request.repo");
const events = require("./cash_request.events");
const { assertTransition, sumField } = require("./cash_request.rules");
const regie = require("../regie/regie.service");
const numbering = require("../../../services/documents/numbering.service");
const documents = require("../../../services/documents/document.service");
const executor = require("../../../services/workflow/executor");
const proofObligations = require("../../../services/compliance/proof-obligation.service");
const onApproved = require("../../../services/workflow/on-approved");
const { assertNoPendingChain } = require("../../../services/workflow/pending-guard");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "cash_request:" + id;

async function replaceLines(client, id, lines) {
  // Replace deletes and re-inserts, so every line gets a NEW id — and any open
  // proof-obligation flag pointing at an old one would be orphaned, warning
  // about a line that no longer exists and that nobody can ever satisfy.
  // Resolve them before the delete; the re-check below re-raises whichever are
  // still genuinely missing a document.
  const previous = await repo.listLines(client, id);
  for (const old of previous) {
     
    await proofObligations.clearFor(client, proofObligations.RULE_KEYS.cash_request_line, "cash_request_line:" + old.cash_request_line_id);
  }
  await repo.deleteLines(client, id);
  const written = [];
  for (const ln of lines) {
    /// eslint-disable-next-line no-await-in-loop
    const row = await repo.insertLine(client, { cash_request_id: id, dictionary_item_id: ln.dictionary_item_id || null, label: ln.label || "Line", budget_amount: ln.budget_amount || 0, spent_amount: ln.spent_amount || 0, is_disbursement: ln.is_disbursement === true, proof_vault_id: ln.proof_vault_id || null });
    written.push(row);
  }
  return written;
}

/**
 * Advisory proof check over the lines just written (MOD-05 §Q4).
 *
 * ADVISORY, NOT A GATE — see services/compliance/proof-obligation.service. A
 * line whose dictionary item always requires a receipt and carries no
 * proof_vault_id raises a WARN flag and notifies the requester; the cash
 * request proceeds regardless. Never throws: the whole point is that
 * disbursements a forwarder needs today are not held up by paperwork that
 * arrives this afternoon.
 */
async function checkProof(client, cr, lines) {
  return proofObligations.checkLines(
    client,
    lines.filter((l) => l.dictionary_item_id).map((l) => ({
      entityRef: "cash_request_line:" + l.cash_request_line_id,
      dictionaryItemId: l.dictionary_item_id,
      proofVaultId: l.proof_vault_id || null,
      amount: l.budget_amount,
    })),
    { kind: "cash_request_line", requesterUserId: cr.requested_by || null, docLabel: "cash request " + (cr.doc_number || "(draft)") },
  );
}

async function createDraft(client, { dossierId = null, costingId = null, requestedBy = null, lines = [], actor = {} }) {
  await client.query("BEGIN");
  try {
    const cr = await repo.insertCR(client, { dossier_id: dossierId, costing_id: costingId, requested_by: requestedBy || actor.user_id || null, status: "DRAFT", amount: sumField(lines, "budget_amount") });
    if (lines.length) await checkProof(client, cr, await replaceLines(client, cr.cash_request_id, lines));
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(cr.cash_request_id), after: cr });
    await client.query("COMMIT");
    return get(client, cr.cash_request_id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function updateDraft(client, { id, lines = null, actor = {} }) {
  const cr = await repo.getCR(client, id);
  if (!cr) throw new AppError("NOT_FOUND", "Cash request not found", 404);
  if (cr.status !== "DRAFT") throw new AppError("LOCKED", "Only a DRAFT cash request can be edited", 422);
  await client.query("BEGIN");
  try {
    if (Array.isArray(lines)) {
      await checkProof(client, cr, await replaceLines(client, id, lines));
      await repo.update(client, id, { amount: sumField(lines, "budget_amount") });
    }
    await client.query("COMMIT");
    return get(client, id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function transition(client, { id, to, entityId = null, date = null, actor = {}, viaChain = false }) {
  const cr = await repo.getCR(client, id);
  if (!cr) throw new AppError("NOT_FOUND", "Cash request not found", 404);
  assertTransition(cr.status, to);
  // Approving/rejecting directly while a chain is live would skip it (W4).
  // Before BEGIN so the refusal doesn't open and roll back a transaction.
  if (to === "APPROVED" || to === "REJECTED") {
    await assertNoPendingChain(client, ref(id), { viaChain, what: "cash request" });
  }
  await client.query("BEGIN");
  try {
    const fields = { status: to };
    if (to === "SUBMITTED" && !cr.doc_number && entityId) {
      const { number } = await numbering.allocate(client, { moduleKey: events.MODULE, entityId, date: date || new Date().toISOString().slice(0, 10) });
      fields.doc_number = number;
    }
    if (to === "APPROVED") fields.approver_id = actor.user_id || null;
    const updated = await repo.update(client, id, fields);
    if (to === "SUBMITTED") {
      await documents.capture(client, { entityRef: ref(id), docType: "CASH_REQUEST", status: "PENDING" });
      // Open the tenant's configurable approval chain (bound to disbursal.requested).
      // No workflow bound → autoApproved and the manual APPROVED path stays
      // available; see the note on W8 in purchase_order.service.js.
      await executor.start(client, { eventTypeKey: "disbursal.requested", entityRef: ref(id), amountXaf: updated.amount === null || updated.amount === undefined ? null : Number(updated.amount) });
    }
    await emitEvent(client, { eventTypeKey: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), after: updated });
    await client.query("COMMIT");
    return updated;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/** Disburse an APPROVED request: issue a régie advance (Dr 581 / Cr treasury) and link it. */
async function disburse(client, { id, entityId, entryDate, sourceDocRef, treasuryCoa = "521", holderUserId = null, actor = {}, ip = null }) {
  const cr = await repo.getCR(client, id);
  if (!cr) throw new AppError("NOT_FOUND", "Cash request not found", 404);
  assertTransition(cr.status, "DISBURSED");
  if (!(Number(cr.amount) > 0)) throw new AppError("BAD_AMOUNT", "cash request amount must be > 0 to disburse", 422);
  await client.query("BEGIN");
  try {
    const advance = await regie.issue(client, {
      holderUserId: holderUserId || cr.requested_by, amount: Number(cr.amount), entityId, entryDate,
      sourceDocRef: sourceDocRef || ref(id), treasuryCoa, actor, ip,
    });
    const regieAdvanceId = advance.advance ? advance.advance.regie_advance_id : (advance.regie_advance_id || null);
    const updated = await repo.update(client, id, { status: "DISBURSED", regie_advance_id: regieAdvanceId });
    await emitEvent(client, { eventTypeKey: events.DISBURSED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.DISBURSED, moduleKey: events.MODULE, entityRef: ref(id), after: { regie_advance_id: regieAdvanceId } });
    await client.query("COMMIT");
    return { cash_request: updated, regie_advance_id: regieAdvanceId };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/** Justify: record actual spend against lines (spent_amount) and close the request. */
async function justify(client, { id, lines = [], actor = {} }) {
  const cr = await repo.getCR(client, id);
  if (!cr) throw new AppError("NOT_FOUND", "Cash request not found", 404);
  assertTransition(cr.status, "JUSTIFIED");
  await client.query("BEGIN");
  try {
    // Justification is the LAST moment a receipt can still be produced, so the
    // advisory check runs here too — a line justified without its supporting
    // document is exactly what the Compliance module will want to see.
    if (lines.length) await checkProof(client, cr, await replaceLines(client, id, lines));
    const updated = await repo.update(client, id, { status: "JUSTIFIED" });
    await audit(client, { actorUserId: actor.user_id || null, action: events.JUSTIFIED, moduleKey: events.MODULE, entityRef: ref(id), after: { spent: sumField(lines, "spent_amount") } });
    await client.query("COMMIT");
    return updated;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function get(client, id) {
  const cr = await repo.getCR(client, id);
  if (!cr) return null;
  cr.lines = await repo.listLines(client, id);
  cr.payments = await repo.listPayments(client, id);
  return cr;
}
const list = (client, q) => repo.list(client, q);

// A cleared approval chain advances the request SUBMITTED → APPROVED (BUILD_CONVENTIONS §2/§5).
onApproved.register("cash_request", (client, { id, actor }) => transition(client, { id, to: "APPROVED", actor: actor || {}, viaChain: true }));

module.exports = { createDraft, updateDraft, transition, disburse, justify, get, list };
