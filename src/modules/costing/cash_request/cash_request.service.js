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
const { assertTransition, sumField, disbursementState } = require("./cash_request.rules");
const regie = require("../regie/regie.service");
const numbering = require("../../../services/documents/numbering.service");
const documents = require("../../../services/documents/document.service");
const executor = require("../../../services/workflow/executor");
const proofObligations = require("../../../services/compliance/proof-obligation.service");
const onApproved = require("../../../services/workflow/on-approved");
const { assertNoPendingChain } = require("../../../services/workflow/pending-guard");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { accountFor } = require("../../../shared/config/finance-accounts");

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

/**
 * The OPS/OVH context the legacy cash request enforced (analysis doc §6.7):
 * an OPS request must name the dossier the money is spent against; an OVH
 * request must name a cost centre AND justify the overhead. Both come from the
 * legacy screen's validation rules (cash-request.php pr_save).
 */
function assertContext({ category, dossierId, costCenter, overheadJustification }) {
  const cat = (category || "OPS").toUpperCase();
  if (cat === "OPS") {
    if (!dossierId) throw new AppError("OPS_CONTEXT_REQUIRED", "An operations file is required for an OPS cash request", 422);
    return cat;
  }
  if (cat === "OVH") {
    if (!costCenter) throw new AppError("COST_CENTER_REQUIRED", "Cost centre is required for an overhead cash request", 422);
    if (!overheadJustification) throw new AppError("OVERHEAD_JUSTIFICATION_REQUIRED", "Justification is required for an overhead cash request", 422);
    return cat;
  }
  throw new AppError("BAD_CATEGORY", "cash request category must be OPS or OVH", 422);
}

async function createDraft(client, { dossierId = null, costingId = null, requestedBy = null, lines = [], beneficiary = null, category = null, costCenter = null, overheadJustification = null, remarks = null, actor = {} }) {
  const cat = assertContext({ category, dossierId, costCenter, overheadJustification });
  await client.query("BEGIN");
  try {
    const cr = await repo.insertCR(client, {
      dossier_id: cat === "OPS" ? dossierId : null, costing_id: costingId,
      requested_by: requestedBy || actor.user_id || null, status: "DRAFT",
      amount: sumField(lines, "budget_amount"), beneficiary, category: cat,
      cost_center: cat === "OVH" ? costCenter : null,
      overhead_justification: cat === "OVH" ? overheadJustification : null,
      remarks,
    });
    if (lines.length) await checkProof(client, cr, await replaceLines(client, cr.cash_request_id, lines));
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(cr.cash_request_id), after: cr });
    await client.query("COMMIT");
    return get(client, cr.cash_request_id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function updateDraft(client, { id, lines = null, patch = {}, actor: _actor = {} }) {
  const cr = await repo.getCR(client, id);
  if (!cr) throw new AppError("NOT_FOUND", "Cash request not found", 404);
  if (cr.status !== "DRAFT") throw new AppError("LOCKED", "Only a DRAFT cash request can be edited", 422);
  await client.query("BEGIN");
  try {
    const fields = {};
    for (const k of ["dossier_id", "costing_id", "beneficiary", "category", "cost_center", "overhead_justification", "remarks"]) {
      if (patch[k] !== undefined) fields[k] = patch[k];
    }
    if (fields.category !== undefined || fields.dossier_id !== undefined || fields.cost_center !== undefined || fields.overhead_justification !== undefined) {
      const cat = assertContext({
        category: fields.category !== undefined ? fields.category : cr.category,
        dossierId: fields.dossier_id !== undefined ? fields.dossier_id : cr.dossier_id,
        costCenter: fields.cost_center !== undefined ? fields.cost_center : cr.cost_center,
        overheadJustification: fields.overhead_justification !== undefined ? fields.overhead_justification : cr.overhead_justification,
      });
      fields.category = cat;
      // Context fields are exclusive per category — the legacy cleared the
      // other side's fields when the category flipped (cash-request.php pr_save).
      if (cat === "OPS") { fields.cost_center = null; fields.overhead_justification = null; }
      if (cat === "OVH") { fields.dossier_id = null; }
    }
    if (Array.isArray(lines)) {
      await checkProof(client, cr, await replaceLines(client, id, lines));
      fields.amount = sumField(lines, "budget_amount");
    }
    if (Object.keys(fields).length) await repo.update(client, id, fields);
    await client.query("COMMIT");
    return get(client, id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * Import the budget lines from the linked APPROVED_LOCKED costing — the legacy
 * `costing_lines_get` behaviour (only an approved costing may feed a cash
 * request; the legacy refused anything else). Lines become budget lines at
 * qty × unit_cost (HT), the amount is recomputed from the children, and the
 * request stays a DRAFT for the requester to review before submitting.
 */
async function importCostingLines(client, { id, actor = {} }) {
  const cr = await repo.getCR(client, id);
  if (!cr) throw new AppError("NOT_FOUND", "Cash request not found", 404);
  if (cr.status !== "DRAFT") throw new AppError("LOCKED", "Only a DRAFT cash request can import costing lines", 422);
  if (!cr.costing_id) throw new AppError("NO_COSTING", "This cash request has no linked costing", 422);
  const costing = await repo.costingForImport(client, cr.costing_id);
  if (!costing) throw new AppError("NOT_FOUND", "Linked costing not found", 404);
  if (costing.status !== "APPROVED_LOCKED") {
    throw new AppError("COSTING_NOT_APPROVED", `Costing ${costing.doc_number || ""} is ${costing.status} — only an APPROVED_LOCKED costing can feed a cash request`.trim(), 403);
  }
  await client.query("BEGIN");
  try {
    const lines = costing.lines.map((l) => ({
      dictionary_item_id: l.dictionary_item_id || null,
      label: l.label,
      budget_amount: Math.round(Number(l.qty || 0) * Number(l.unit_cost || 0) * 100) / 100,
      spent_amount: 0,
      is_disbursement: l.is_disbursement === true,
    }));
    await checkProof(client, cr, await replaceLines(client, id, lines));
    await repo.update(client, id, { amount: sumField(lines, "budget_amount") });
    await audit(client, { actorUserId: actor.user_id || null, action: "cash_request.lines_imported", moduleKey: events.MODULE, entityRef: ref(id), after: { costing_id: cr.costing_id, line_count: lines.length } });
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
  if (to === "VALIDATED" || to === "APPROVED" || to === "REJECTED") {
    await assertNoPendingChain(client, ref(id), { viaChain, what: "cash request" });
  }
  await client.query("BEGIN");
  try {
    const fields = { status: to };
    if (to === "SUBMITTED" && !cr.doc_number && entityId) {
      const { number } = await numbering.allocate(client, { moduleKey: events.MODULE, entityId, date: date || new Date().toISOString().slice(0, 10) });
      fields.doc_number = number;
    }
    if (to === "VALIDATED") {
      // DATA 2.4 — FK to app_user lives in LIVE while this row may land in
      // SANDBOX; resolveActorId returns null instead of raising 23503.
      fields.validated_by = await resolveActorId(client, actor.user_id);
      fields.validated_at = new Date().toISOString();
    }
    if (to === "APPROVED") fields.approver_id = actor.user_id || null;
    const updated = await repo.update(client, id, fields);
    if (to === "SUBMITTED") {
      await documents.capture(client, { entityRef: ref(id), docType: "CASH_REQUEST", status: "PENDING" });
      // First approval leg: finance validates. No workflow bound → autoApproved
      // and the manual VALIDATED path stays available (W8 pattern).
      await executor.start(client, { eventTypeKey: "disbursal.requested", entityRef: ref(id), amountXaf: updated.amount === null || updated.amount === undefined ? null : Number(updated.amount) });
    }
    if (to === "VALIDATED") {
      // Second approval leg: management approves (10721, seeded default
      // workflow on disbursal.validated). Completion → APPROVED via the
      // onApproved handler below.
      await executor.start(client, { eventTypeKey: "disbursal.validated", entityRef: ref(id), amountXaf: updated.amount === null || updated.amount === undefined ? null : Number(updated.amount) });
    }
    await emitEvent(client, { eventTypeKey: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), after: updated });
    await client.query("COMMIT");
    return updated;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * Disburse an APPROVED request, in full or in instalments (10719).
 *
 * WHAT THIS USED TO DO, AND WHY IT WAS WRONG. It took no amount, issued ONE
 * advance for the whole of `cr.amount`, and set the status straight to
 * DISBURSED. `cash_request_payment` — one-to-many, with a treasury account, a
 * date and an entry_id, hardened by 0498 and CHECKed by 0497 — was never
 * written to by anything. So a request the treasury could only fund in two
 * tranches read as fully disbursed the moment the first franc moved, and the
 * second tranche had nowhere to go.
 *
 * EACH INSTALMENT ISSUES ITS OWN RÉGIE ADVANCE. A régie advance is a quantity
 * of cash in a holder's hands from a date: two payments a fortnight apart are
 * two advances, each with its own issue posting, its own policy window and its
 * own aging clock. Topping up the first would restate an amount its own ledger
 * entry contradicts. The advance is linked from the PAYMENT row
 * (`cash_request_payment.regie_advance_id`, UNIQUE); `cash_request.regie_advance_id`
 * keeps pointing at the first so every pre-10719 reader stays correct.
 *
 * `amount` is optional and defaults to the whole outstanding balance, so the
 * common case — one payment for the full request — is unchanged for callers,
 * and the client need not send an amount it does not have a reason to vary.
 */
async function disburse(client, { id, amount = null, entityId, entryDate, sourceDocRef, treasuryCoa = null, treasuryAccountId = null, holderUserId = null, memo = null, actor = {}, ip = null }) {
  // Read outside the transaction only to fail fast on a missing row; the
  // authoritative read is the locked one below.
  const peek = await repo.getCR(client, id);
  if (!peek) throw new AppError("NOT_FOUND", "Cash request not found", 404);

  // Was hardcoded "521" — a non-postable grouping (9000:77) that the ledger
  // trigger refuses. Resolved from settings; an explicit override still wins.
  const treasury = await accountFor(client, "treasury", treasuryCoa);

  await client.query("BEGIN");
  try {
    // FOR UPDATE: two concurrent instalments would otherwise both read the same
    // total, both derive PARTIALLY_DISBURSED, and leave the cache understating
    // the cash actually issued.
    const cr = await repo.getCRForUpdate(client, id);
    const requested = Number(cr.amount || 0);
    if (!(requested > 0)) throw new AppError("BAD_AMOUNT", "cash request amount must be > 0 to disburse", 422);

    const alreadyPaid = await repo.paymentsTotal(client, id);
    const outstanding = Math.round((requested - alreadyPaid) * 100) / 100;
    if (!(outstanding > 0)) {
      throw new AppError("FULLY_DISBURSED", "This request has already been disbursed in full", 422);
    }

    // Default to the rest of the request: the full-payment case stays a
    // one-argument call.
    const pay = amount === null || amount === undefined ? outstanding : Math.round(Number(amount) * 100) / 100;
    if (!(pay > 0)) throw new AppError("BAD_AMOUNT", "disbursement amount must be > 0", 422);

    // Derive the resulting status BEFORE any posting, so an over-payment is
    // refused without having issued an advance the caller then has to unwind.
    const nextStatus = disbursementState(requested, alreadyPaid + pay);
    assertTransition(cr.status, nextStatus);

    const advance = await regie.issue(client, {
      holderUserId: holderUserId || cr.requested_by, amount: pay, entityId, entryDate,
      sourceDocRef: sourceDocRef || ref(id), treasuryCoa: treasury, actor, ip,
    });
    const regieAdvanceId = advance.advance ? advance.advance.regie_advance_id : (advance.regie_advance_id || null);

    // The payment row is the record of THIS movement of money.
    const payment = await repo.insertPayment(client, {
      cash_request_id: id,
      treasury_account_id: treasuryAccountId,
      amount: pay,
      paid_on: entryDate,
      entry_id: advance.entry ? advance.entry.entry_id : null,
      regie_advance_id: regieAdvanceId,
      memo,
      // DATA 2.4: this column is REFERENCES app_user(user_id), and identity
      // lives in LIVE while this row lands in whichever schema the request
      // selected. A live id stored beside SANDBOX data raises 23503 and takes
      // the whole disbursement down with it — including the advance already
      // issued above. resolveActorId returns null instead: losing an
      // attribution beats failing the movement of money that it describes.
      created_by: await resolveActorId(client, actor.user_id),
    });

    // Recompute from the children rather than incrementing — an increment
    // drifts the first time a payment is voided (10717's rule, unchanged).
    const paidNow = await repo.paymentsTotal(client, id);
    const fields = { status: nextStatus, disbursed_amount: paidNow };
    // Keep the legacy single link pointing at the FIRST advance.
    if (!cr.regie_advance_id) fields.regie_advance_id = regieAdvanceId;
    const updated = await repo.update(client, id, fields);

    const eventKey = nextStatus === "DISBURSED" ? events.DISBURSED : events.PARTIALLY_DISBURSED;
    await emitEvent(client, { eventTypeKey: eventKey, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: eventKey, moduleKey: events.MODULE, entityRef: ref(id), after: { amount: pay, disbursed_amount: paidNow, regie_advance_id: regieAdvanceId } });
    await client.query("COMMIT");
    return { cash_request: updated, regie_advance_id: regieAdvanceId, payment, outstanding: Math.round((requested - paidNow) * 100) / 100 };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * Justify: record actual spend against lines (spent_amount), RETIRE THE LINKED
 * RÉGIE ADVANCE, and close the request.
 *
 * THE DEFECT THIS FIXES. Before 10717 this marked the request JUSTIFIED and
 * stopped. The advance it was disbursed from stayed open in 581 with
 * justified_amount = 0, so the aging worker later reclassified the full amount
 * to 4211 — a receivable raised against a holder who HAD already accounted for
 * the money, evidenced by the very lines being written here. A wrong ledger
 * entry produced by a workflow completing normally.
 *
 * The retirement runs inside THIS transaction (via `regie.retireCore`, which
 * does not open its own) so the request and its advance can never disagree: if
 * the retirement is refused — over-retirement, a missing receipt — the whole
 * justification rolls back rather than leaving a closed request over an open
 * advance.
 *
 * Each spent line becomes one RECEIPT retirement tagged with the request's
 * dossier, which is exactly the per-dossier 4731 split KB §8.2 describes as the
 * OUTPUT of this workflow.
 */
async function justify(client, { id, lines = [], entityId = null, entryDate = null, actor = {}, ip = null }) {
  const cr = await repo.getCR(client, id);
  if (!cr) throw new AppError("NOT_FOUND", "Cash request not found", 404);
  assertTransition(cr.status, "JUSTIFIED");

  // Read policy before BEGIN: it is a plain SELECT and keeps the transaction short.
  const pol = cr.regie_advance_id ? await regie.policy(client) : null;

  await client.query("BEGIN");
  try {
    // Justification is the LAST moment a receipt can still be produced, so the
    // advisory check runs here too — a line justified without its supporting
    // document is exactly what the Compliance module will want to see.
    const written = lines.length ? await replaceLines(client, id, lines) : [];
    if (lines.length) await checkProof(client, cr, written);

    const spent = sumField(lines, "spent_amount");
    let retired = null;

    if (cr.regie_advance_id) {
      if (!cr.dossier_id) {
        // A receipt lands in 4731, which is requires_analytic (9001:113) — the
        // ledger trigger would refuse the posting. Fail with the reason rather
        // than letting a raw RAISE surface from inside the transaction.
        throw new AppError(
          "DOSSIER_REQUIRED",
          "This request draws on a régie advance, so it must be attached to a dossier before it can be justified",
          422,
        );
      }
      if (spent > 0) {
        // One RECEIPT for the spend. Proof was already checked per line above;
        // pass the first line's document so the retirement carries evidence.
        const proof = written.find((l) => l.proof_vault_id) || null;
        retired = await regie.retireCore(client, {
          advanceId: cr.regie_advance_id,
          kind: "RECEIPT",
          dossierId: cr.dossier_id,
          amount: spent,
          proofVaultId: proof ? proof.proof_vault_id : null,
          memo: "Justified by cash request " + (cr.doc_number || id),
          entityId, entryDate,
          sourceDocRef: ref(id),
          actor, ip,
          policy: pol,
        });

        // Q1, answered: the remainder must come back before the advance closes.
        // KB §6.8 step 4 says a fully justified advance nets 581 to ZERO, and
        // allowing a "justified" request to sit over an open advance is exactly
        // the bug above in a smaller form. The holder returns the unspent cash
        // (Dr 571) as a separate CASH_RETURN, which the UI offers on the advance.
        const open = Number(retired.advance.amount)
          - Number(retired.advance.justified_amount)
          - Number(retired.advance.returned_amount);
        if (open > 0 && !pol.allowPartialJustification) {
          throw new AppError(
            "ADVANCE_NOT_CLEARED",
            `${Math.round(open * 100) / 100} of this advance is still open — record the unspent cash returned (or a write-off) before justifying the request`,
            422,
          );
        }
      }
    }

    const updated = await repo.update(client, id, { status: "JUSTIFIED" });
    await audit(client, { actorUserId: actor.user_id || null, action: events.JUSTIFIED, moduleKey: events.MODULE, entityRef: ref(id), after: { spent, regie_advance_id: cr.regie_advance_id || null, retired: !!retired } });
    await client.query("COMMIT");
    return { ...updated, regie_retirement: retired ? retired.retirement : null };
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
/**
 * A cleared approval chain advances the request ONE step of the two (10721):
 * the disbursal.requested chain (finance, default) completing a SUBMITTED
 * request validates it; the disbursal.validated chain (management, default)
 * completing a VALIDATED request approves it. The target is read from the
 * current status so the same handler serves both legs.
 */
onApproved.register("cash_request", async (client, { id, actor }) => {
  const cr = await repo.getCR(client, id);
  const to = cr && cr.status === "SUBMITTED" ? "VALIDATED" : "APPROVED";
  return transition(client, { id, to, actor: actor || {}, viaChain: true });
});

module.exports = { createDraft, updateDraft, transition, disburse, justify, importCostingLines, get, list };
