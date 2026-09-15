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
const {
  assertTransition, sumField, computeTotals, assertMethod, disbursementState,
  budgetBreaches, apportionSettlement, budgetControl,
  // Which act leaves which signature (12773). In the rules because adding a key
  // puts another signature on every voucher — see the note there.
  TRANSITION_SEAL, DISBURSE_SEAL, RECEIPT_SEAL,
} = require("./cash_request.rules");
const regie = require("../regie/regie.service");
// The budget this document draws down (12771). The costing owns that read and
// its arithmetic; asking it is one call and keeps the formula in one place.
// No cycle: costing.service does not know cash requests exist.
const costingService = require("../costing/costing.service");
const currencySvc = require("../../master/currency/currency.service");
const { logger } = require("../../../config/logger");
const numbering = require("../../../services/documents/numbering.service");
const documents = require("../../../services/documents/document.service");
const executor = require("../../../services/workflow/executor");
const proofObligations = require("../../../services/compliance/proof-obligation.service");
// Q17: the catalogue decides whether a line owes a receipt. One reader for that
// question in the whole codebase — the compliance service uses the same one.
const dictionaryRules = require("../../master/financial_dictionary/financial_dictionary.rules");
const onApproved = require("../../../services/workflow/on-approved");
const { assertNoPendingChain } = require("../../../services/workflow/pending-guard");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { accountFor } = require("../../../shared/config/finance-accounts");

const ref = (id) => "cash_request:" + id;
/*
 * The receipt for ONE instalment (12773, owner Q16 C).
 *
 * `document_vault`, `document_signature` and the verification portal are all
 * keyed on one entity_ref per document, and the renderer derives the ref it
 * looks seals up under as `<doc_type lowercased>:<record id>`
 * (template.service.js). So this string is not a convention this file invents —
 * it is the one the renderer will use, spelled here so the two cannot drift.
 */
const receiptRef = (paymentId) => "cash_payment_receipt:" + paymentId;

// Money rounds to two places everywhere in this module. Its twin lives in
// cash_request.rules (private there for the same reason): a rule file that
// imports a helper from a service is a rule file with a dependency.
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/**
 * One payload line's columns (12771).
 *
 * `qty` × `unit_cost` is the shape the legacy carried and `costing_line` still
 * does; `budget_amount` is DERIVED from them and kept, so every existing reader
 * — the voucher, `computeTotals`, the AI manifest — stays correct.
 *
 * BACKWARD COMPATIBLE BY CONSTRUCTION. A caller that sends only `budget_amount`
 * (the AI actions and today's create form both do) is read as 1 × that amount,
 * which is exactly what it meant.
 */
function lineFields(l, lineNo) {
  const shaped = l.qty !== undefined || l.unit_cost !== undefined;
  const qty = shaped ? Number(l.qty ?? 1) : 1;
  const unit = shaped ? Number(l.unit_cost ?? 0) : Number(l.budget_amount || 0);
  const q = Number.isFinite(qty) && qty > 0 ? qty : 1;
  const u = Number.isFinite(unit) && unit > 0 ? unit : 0;
  return {
    dictionary_item_id: l.dictionary_item_id || null,
    // The budget line this claim draws down. NULL on an overhead request, which
    // has no operations file and therefore no costing.
    costing_line_id: l.costing_line_id || null,
    label: l.label || "Line",
    line_no: lineNo,
    qty: q,
    unit_cost: round2(u),
    budget_amount: round2(q * u),
    spent_amount: l.spent_amount || 0,
    is_disbursement: l.is_disbursement === true,
    proof_vault_id: l.proof_vault_id || null,
    // §3.5 — legacy per-line VAT % and "Just. Req?" (10746).
    vat_percent: l.vat_percent ?? null,
    justification_required: l.justification_required === true,
    source: l.costing_line_id ? "IMPORTED" : "MANUAL",
  };
}

/**
 * Write the request's lines, KEEPING the id of every line that survives (12771).
 *
 * ── WHY THIS IS NO LONGER A DELETE-AND-REINSERT ────────────────────────────
 *
 * It was, so every `cash_request_line_id` changed on every draft save — which
 * is why this function had to clear every proof-obligation flag first and let
 * the re-check raise them again: the flags pointed at ids that were about to
 * stop existing. Matching in place removes the dance entirely, and only the
 * lines actually being REMOVED lose their flag.
 *
 * Identity, in order of confidence:
 *   1. `cash_request_line_id` in the payload — the worksheet round-trips it, so
 *      an edit is unambiguous even when the label and the amount both change;
 *   2. `costing_line_id` — an imported line is the claim against that budget
 *      line, and a request holds at most one per budget line in practice;
 *   3. neither → a new line.
 *
 * A prior line is claimed at most once (the `Set`), so two payload lines
 * pointing at the same budget line produce one edit and one insert rather than
 * two edits of the same row.
 */
async function replaceLines(client, id, rawLines) {
  // Q17 — the catalogue's floor, applied HERE because this is the one function
  // every writer of lines goes through (create, edit, import). Defaulting it at
  // three call sites is defaulting it at two of them within a year.
  const lines = await applyCatalogueObligations(client, rawLines);
  const prior = await repo.lineIdentities(client, id);
  const byId = new Map(prior.map((p) => [p.cash_request_line_id, p]));
  const byCostingLine = new Map();
  for (const p of prior) {
    if (p.costing_line_id && !byCostingLine.has(p.costing_line_id)) byCostingLine.set(p.costing_line_id, p);
  }

  const kept = new Set();
  const writes = [];
  lines.forEach((l, i) => {
    const fields = lineFields(l, i + 1);
    let match = l.cash_request_line_id ? byId.get(l.cash_request_line_id) : null;
    if (!match && fields.costing_line_id) match = byCostingLine.get(fields.costing_line_id);
    if (match && !kept.has(match.cash_request_line_id)) {
      kept.add(match.cash_request_line_id);
      writes.push({ id: match.cash_request_line_id, fields });
    } else {
      writes.push({ id: null, fields: { cash_request_id: id, ...fields } });
    }
  });

  // A flag on a line that is about to stop existing warns about something
  // nobody can ever satisfy. Only the departing lines are cleared; `checkProof`
  // re-raises whichever of the survivors are still missing a document.
  for (const p of prior) {
    if (kept.has(p.cash_request_line_id)) continue;
     
    await proofObligations.clearFor(client, proofObligations.RULE_KEYS.cash_request_line, "cash_request_line:" + p.cash_request_line_id);
  }

  await repo.deleteLinesExcept(client, id, [...kept]);
  const written = [];
  for (const w of writes) {
     
    written.push(w.id ? await repo.updateLine(client, w.id, w.fields) : await repo.insertLine(client, w.fields));
  }
  return written;
}

/**
 * Record what was actually SPENT against lines that already exist (12771).
 *
 * ── WHY JUSTIFICATION MUST NOT GO THROUGH `replaceLines` ───────────────────
 *
 * It used to, and once a line carries `costing_line_id` that is destructive: a
 * justify payload built from a screen carries labels and amounts but no ids, so
 * every line would be read as new, the originals deleted, and the budget link
 * silently lost. The ledger would then stop counting a disbursed request as
 * committed — the file would appear to regain headroom it had already spent.
 *
 * It is also the wrong MODEL. By the time a request is justified it has been
 * disbursed: its lines are frozen facts (what was approved and paid), and
 * justification says what each was spent on. Nothing is added and nothing is
 * removed, so this only ever writes `spent_amount` and the supporting document.
 *
 * Matched by id when the caller round-trips one, else by position — the order
 * `listLines` returns is `line_no`, which is the order the screen rendered.
 * A payload longer than the line set is refused rather than truncated: it means
 * the caller is trying to invent a line at justification, and silently dropping
 * it would lose spend somebody recorded.
 */
async function applySpend(client, id, lines) {
  const existing = await repo.listLines(client, id);
  if (lines.length > existing.length) {
    throw new AppError(
      "LINE_COUNT_MISMATCH",
      `This request has ${existing.length} line(s); the justification carries ${lines.length}. Justification records what was spent against the lines that were approved — it cannot add new ones.`,
      422,
    );
  }
  const byId = new Map(existing.map((l) => [l.cash_request_line_id, l]));
  const written = [];
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    const target = (l.cash_request_line_id && byId.get(l.cash_request_line_id)) || existing[i];
    if (!target) continue;
    const fields = { spent_amount: Number(l.spent_amount || 0) };
    // Only overwrite the proof when one is offered — a payload that omits it is
    // not a payload that revokes it.
    if (l.proof_vault_id !== undefined) fields.proof_vault_id = l.proof_vault_id || null;
     
    written.push(await repo.updateLine(client, target.cash_request_line_id, fields));
  }
  return written;
}

/* ═══════════════════════ THE SEALS (12773, owner Q12) ═════════════════════
 *
 * ── WHY THE TRANSITION SIGNS, AND NOT A PERSON ─────────────────────────────
 *
 * The same argument the costing settled, and it transfers whole: the button IS
 * the decision. An approver who has just pressed "Approve" has approved, and
 * asking them to then choose a signature card is asking the same question
 * twice — which is how a control becomes a thing people click through. Sealing
 * inside the transition also makes the two inseparable: there is no path that
 * records an approval without a seal, and no seal not backed by a status
 * change.
 *
 * ── THREE SIGNATORIES, AND WHY VALIDATION IS NOT ONE OF THEM ───────────────
 *
 * The owner's rule (Q12, Q20): the requestor, the approving authority and the
 * disbursing authority. *"Validating is just a visa. No official signature."*
 * Finance checks the funds and the budget against the control block; it does
 * not commit the company to anything, and a fourth seal on the page would
 * misdescribe who decided.
 *
 *   SUBMITTED   the requestor  — raising the claim IS the assertion
 *   APPROVED    the approver   — the authority the money moves under
 *   first payment the disburser — on the voucher once, and on every receipt
 *
 * The disbursing seal lands on the VOUCHER only for the first instalment. A
 * request paid in three tranches would otherwise carry three identical seals
 * and a five-box signature strip; each tranche gets its own seal where it
 * belongs, on its own receipt.
 *
 * ── AND WHY A FAILURE HERE DOES NOT UNDO THE DECISION ──────────────────────
 *
 * Best-effort, deliberately — the costing's rule, for the costing's reason.
 * The decision is the business fact; the seal is its evidence. A tenant that
 * has not run 12773, or has emptied its policy, would otherwise find every
 * approval failing with EMPTY_SIGNATURE_MENU on a screen that says nothing
 * about signatures. It is logged at error level: an unsealed approval is a
 * real gap in the evidence chain, just not one worth refusing the money over.
 */
async function seal(client, { entityRef, docType, recordId, signReason, actor = {} }) {
  if (!signReason || !actor.user_id) return;
  try {
    // Required lazily: document_signature pulls the template service, which
    // requires this module back for the cash-request projection.
    const signatures = require("../../vault/document_signature/document_signature.service");
    const presets = require("../../../services/signatures/presets");
    const templateSvc = require("../../documents/template/template.service");
    const menu = await presets.resolveMenu(client, { docType });
    /*
     * The document as it stands INSIDE this transaction, passed in rather than
     * left to `signInternal` to load. Its own loader would run after the caller
     * has decided WHEN to build it, and the whole point is that this payload is
     * the post-transition document — a seal built before the update would
     * attest to the status the request was moving OUT of.
     *
     * `loadRecord` is the same projection the page renders from, because
     * canonical.js hashes the shape the registry produces; hashing a second,
     * hand-rolled shape would mean the seal attests to something the reader
     * never sees. It is safe here for one reason: it reads the rows this
     * transaction has already written, on this client.
     */
    const rec = await templateSvc.loadRecord(client, docType, recordId);
    await signatures.signInternal(client, {
      entityRef, docType, presetCode: menu.default, signReason, actor, doc: rec ? rec.data : null,
    });
  } catch (err) {
    logger.error(
      { err, entity_ref: entityRef, doc_type: docType, sign_reason: signReason },
      "cash request step could not be sealed; the decision stands, the evidence does not",
    );
  }
}

/**
 * Q17 — the justification tick, DEFAULTED FROM THE CATALOGUE and editable up
 * but never down.
 *
 * `dictionary_item` already declares `receipt_requirement` and
 * `requires_justification` (0630), and `financial_dictionary.rules
 * .proofObligation` is the one place that reads them as an obligation. Until
 * now `cash_request_line.justification_required` was a free boolean nothing
 * defaulted: a requester could untick a line for an item the catalogue says
 * ALWAYS needs a receipt, and the request would close without one.
 *
 * So the catalogue decides the FLOOR and the user may only be stricter. This is
 * the rule the costing line grid already applies to VAT and to a line's nature,
 * and its argument is the same: the legacy defaulted a VAT box to ticked and
 * its own sample sheet charges 19.25% VAT on a customs duty. The screen renders
 * an obliged tick DISABLED WITH ITS REASON SHOWN rather than hidden, so nobody
 * meets a control that silently refuses to move.
 *
 * CONDITIONALLY_REQUIRED is deliberately not an obligation here — that is
 * `proofObligation`'s own rule and the reason it gives is right: "it depends"
 * cannot be decided from the catalogue row alone, and a flag raised on a maybe
 * is noise. The user may still tick it by hand, which is exactly the point of
 * "editable up".
 */
async function applyCatalogueObligations(client, lines) {
  const ids = [...new Set(lines.map((l) => l.dictionary_item_id).filter(Boolean))];
  if (!ids.length) return lines;
  const { rows } = await client.query(
    "SELECT dictionary_item_id, receipt_requirement, requires_justification "
      + "FROM dictionary_item WHERE dictionary_item_id = ANY($1::uuid[])",
    [ids],
  );
  const obliged = new Set(
    rows.filter((r) => dictionaryRules.proofObligation(r).required).map((r) => r.dictionary_item_id),
  );
  if (!obliged.size) return lines;
  return lines.map((l) => (l.dictionary_item_id && obliged.has(l.dictionary_item_id)
    ? { ...l, justification_required: true }
    : l));
}

/**
 * The money this request is denominated in, and the rate it converts at (12771).
 *
 * AN OPS REQUEST INHERITS THE COSTING'S CURRENCY AND CANNOT DIFFER FROM IT.
 * Comparing a claim in one currency against a budget in another is not
 * arithmetic, and there is no honest rate to apply — the sheet was approved at
 * its own. To change it, change the costing; that is what "every spend goes
 * through the costing" means for the money unit too.
 *
 * An overhead request has no costing, so it names its own and the rate comes
 * from Currencies & FX (synced daily, manually overridable) rather than from
 * anyone's memory. Falls back to 1 rather than failing: a missing quote must
 * not stop someone raising a request, and the figures stay correct in their own
 * currency. Same rule and the same fallback direction as `costing.resolveRate`.
 */
async function resolveMoney(client, { ledger = null, currency = null, explicitRate = null }) {
  if (ledger) {
    return {
      currency: ledger.currency || "XAF",
      exchange_rate_to_xaf: Number(ledger.exchange_rate_to_xaf) > 0 ? Number(ledger.exchange_rate_to_xaf) : 1,
    };
  }
  const code = String(currency || "XAF").toUpperCase();
  if (explicitRate !== null && explicitRate !== undefined && Number(explicitRate) > 0) {
    return { currency: code, exchange_rate_to_xaf: Number(explicitRate) };
  }
  if (code === "XAF") return { currency: "XAF", exchange_rate_to_xaf: 1 };
  try {
    const hit = await currencySvc.rateFor(client, {
      base: code, quote: "XAF", date: new Date().toISOString().slice(0, 10),
    });
    const rate = Number(hit && hit.rate);
    if (Number.isFinite(rate) && rate > 0) return { currency: code, exchange_rate_to_xaf: rate };
  } catch (err) {
    // @silent:expected — no quote on file for this pair/date is ordinary (a
    // currency added this morning, a weekend with no sync). The request stays
    // valid in its own currency and the rate can be typed.
    logger.info({ err: err && err.message, currency: code }, "no FX quote for cash request; defaulting rate to 1");
  }
  return { currency: code, exchange_rate_to_xaf: 1 };
}

/**
 * The header money columns for a given line set and rate.
 *
 * The lines are NORMALISED through `lineFields` first, because `computeTotals`
 * reads `budget_amount` and 12771 lets a caller send `qty` × `unit_cost`
 * instead — an un-normalised payload of that shape would total to zero.
 * `lineFields` is idempotent, so a row read back from the database and a raw
 * payload both arrive at the same figure.
 */
function moneyFields(lines, money) {
  // §3.5 — `amount` is the TOTAL PAYABLE (subtotal + per-line VAT): the cash
  // actually being requested. It was the HT sum, which under-funded every taxed
  // spend.
  const amount = computeTotals(lines.map((l, i) => lineFields(l, i + 1))).total_payable;
  return {
    amount,
    currency: money.currency,
    exchange_rate_to_xaf: money.exchange_rate_to_xaf,
    // The only column any cross-request sum may use — costing.total_ttc_xaf's
    // rule, one document down.
    amount_xaf: round2(amount * money.exchange_rate_to_xaf),
  };
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

async function createDraft(client, { dossierId = null, costingId = null, requestedBy = null, lines = [], beneficiary = null, category = null, costCenter = null, overheadJustification = null, remarks = null, disbursementMethod = null, disbursementDetails = null, currency = null, exchangeRateToXaf = null, actor = {} }) {
  const cat = assertContext({ category, dossierId, costCenter, overheadJustification });
  // §3.5 — the method may be named at draft time (validated per method) or
  // left for later; submission requires it (see transition).
  const method = disbursementMethod ? assertMethod(disbursementMethod, disbursementDetails) : null;
  // 12771 — an OPS request takes the linked costing's money unit; an overhead
  // one names its own. Resolved before BEGIN: both are plain reads.
  const ledger = costingId ? await costingService.budget(client, costingId) : null;
  const money = await resolveMoney(client, { ledger, currency, explicitRate: exchangeRateToXaf });
  await client.query("BEGIN");
  try {
    const cr = await repo.insertCR(client, {
      dossier_id: cat === "OPS" ? dossierId : null, costing_id: costingId,
      requested_by: requestedBy || actor.user_id || null, status: "DRAFT",
      ...moneyFields(lines, money),
      beneficiary, category: cat,
      cost_center: cat === "OVH" ? costCenter : null,
      overhead_justification: cat === "OVH" ? overheadJustification : null,
      remarks,
      disbursement_method: method ? method.method : null,
      disbursement_details: JSON.stringify(method ? method.details : {}),
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
    // §3.5 — changing the method re-validates its conditional fields and
    // stores only that method's own fields.
    if (patch.disbursement_method !== undefined) {
      if (patch.disbursement_method === null) {
        fields.disbursement_method = null;
        fields.disbursement_details = JSON.stringify({});
      } else {
        const m = assertMethod(patch.disbursement_method, patch.disbursement_details ?? cr.disbursement_details);
        fields.disbursement_method = m.method;
        fields.disbursement_details = JSON.stringify(m.details);
      }
    } else if (patch.disbursement_details !== undefined && cr.disbursement_method) {
      const m = assertMethod(cr.disbursement_method, patch.disbursement_details);
      fields.disbursement_details = JSON.stringify(m.details);
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
    if (Array.isArray(lines)) await checkProof(client, cr, await replaceLines(client, id, lines));

    /*
     * 12771 — the money, recomputed whenever anything it depends on moves: the
     * lines, the currency, the rate, or the costing the request now draws on.
     *
     * Re-rating on a currency change alone matters as much as on a line change.
     * Leaving `amount_xaf` stale would put a figure in the one column every
     * cross-request sum is required to use that no longer matches the money it
     * describes — and nothing downstream could tell.
     */
    const moneyMoved = Array.isArray(lines)
      || patch.currency !== undefined
      || patch.exchange_rate_to_xaf !== undefined
      || fields.costing_id !== undefined;
    if (moneyMoved) {
      const costingId = fields.costing_id !== undefined ? fields.costing_id : cr.costing_id;
      const ledger = costingId ? await costingService.budget(client, costingId) : null;
      const money = await resolveMoney(client, {
        ledger,
        currency: patch.currency !== undefined ? patch.currency : cr.currency,
        explicitRate: patch.exchange_rate_to_xaf,
      });
      // From the lines AS WRITTEN — read back rather than trusting the payload,
      // so the stored total and the line set cannot diverge.
      Object.assign(fields, moneyFields(await repo.listLines(client, id), money));
    }
    if (Object.keys(fields).length) await repo.update(client, id, fields);
    await client.query("COMMIT");
    return get(client, id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * One budget line, turned into the claim a new request should default to (12771).
 *
 * The default is what is LEFT, not what was budgeted. Claim 100 000 of a
 * 150 000 Port Charges line today and the next request opens showing 50 000 —
 * which is the whole point of the ledger and the thing the legacy could not do.
 *
 * FIDELITY WHERE IT IS FREE. When nothing has been claimed yet, the costing's
 * own shape is carried across verbatim — 2 × 99 000 stays two boxes at 99 000,
 * so an approver can see the count change. A partial top-up is not "1.4
 * containers", so it lands as one line at the remaining net.
 *
 * The reconstructed claim is checked against the balance rather than assumed
 * equal to it: the VAT rate is derived by division and rounded, and a rounded
 * rate applied back to a net can land a hair over. Flooring the net in that
 * case means an imported line can never breach the budget it was imported from.
 */
function claimFromBudgetLine(row) {
  const budget = Number(row.budget) || 0;
  const remaining = Number(row.remaining) || 0;
  const qty = Number(row.qty) || 1;
  const base = {
    costing_line_id: row.costing_line_id,
    dictionary_item_id: row.dictionary_item_id || null,
    label: row.label || "Line",
    /*
     * NO VAT RATE ON A CASH REQUEST LINE.
     *
     * It used to reverse-engineer one — `vat / net`, to four places — and then
     * re-apply it to a net to reconstruct the TTC the budget line already knew.
     * A round trip through a derived percentage, and it did three bad things:
     *
     *   · it DRIFTED. `budget` is the costing's own TTC; net × a rounded rate
     *     is not always the same number, and the claim was compared against
     *     `remaining` to the cent.
     *   · it LIED ON SCREEN. The column showed the rate to two places, so a
     *     line carrying 3.30 of VAT on 100,000 displayed "0.00" and then
     *     charged 100,003.30 — the reader could not reconcile what they saw.
     *   · it was EDITABLE. Changing the rate on a cash request changes the tax
     *     on a budget line that was approved with its tax, which is exactly the
     *     drift the ledger exists to prevent.
     *
     * The costing hands over an amount that is already TTC (owner decision Q8),
     * so the claim simply IS that amount. `lineClaim` multiplies by
     * (1 + 0/100) and returns it unchanged; every reader downstream — the
     * ledger's SQL twin, the totals, the voucher — keeps working untouched,
     * because a null rate was always a legal value for them.
     */
    vat_percent: null,
    is_disbursement: row.is_disbursement === true,
  };

  // The whole line is free: keep the costing's own SHAPE, so an approver can
  // still see two containers rather than one lump. The unit is the TTC unit;
  // rounding it to the cent can only ever land at or under `budget`, never over.
  if (remaining >= budget) {
    return { ...base, qty, unit_cost: Math.floor((budget / qty) * 100) / 100 };
  }
  // A partial top-up is not "1.4 containers", so it lands as one line at the
  // balance — which is already TTC and needs no reconstruction.
  return { ...base, qty: 1, unit_cost: remaining > 0 ? remaining : 0 };
}

/**
 * Load this request's lines from the linked APPROVED_LOCKED costing, defaulted
 * to what each budget line has left (12771; legacy `costing_lines_get`).
 *
 * Only an approved costing may feed a cash request — the legacy refused
 * anything else and so do we, with the sheet's reference in the error so the
 * screen can link straight to it.
 *
 * Fully-claimed lines are SKIPPED rather than imported at zero. A line with
 * nothing left is not a claim; importing it would put a row on the sheet whose
 * only possible value is one that breaches.
 *
 * The request stays a DRAFT for the requester to review — untick what this
 * request is not for, edit an amount down — before submitting.
 */
async function importCostingLines(client, { id, actor = {} }) {
  const cr = await repo.getCR(client, id);
  if (!cr) throw new AppError("NOT_FOUND", "Cash request not found", 404);
  if (cr.status !== "DRAFT") throw new AppError("LOCKED", "Only a DRAFT cash request can import costing lines", 422);
  if (!cr.costing_id) throw new AppError("NO_COSTING", "This cash request has no linked costing", 422);

  const ledger = await costingService.budget(client, cr.costing_id, { excludeCashRequestId: id });
  if (!ledger.can_fund) {
    throw new AppError(
      "COSTING_NOT_APPROVED",
      `Costing ${ledger.doc_number || ""} is ${ledger.status} — only an approved costing can fund a cash request. Approve it, or request an unlock to amend it first.`.trim(),
      403,
      { costing_id: ledger.costing_id, doc_number: ledger.doc_number, status: ledger.status },
    );
  }

  const claimable = ledger.lines.filter((r) => Number(r.remaining) > 0);
  if (!claimable.length) {
    throw new AppError(
      "BUDGET_EXHAUSTED",
      `Every line of costing ${ledger.doc_number || ""} is fully claimed. Request an unlock and amend the budget to raise more cash against this file.`.trim(),
      422,
      { costing_id: ledger.costing_id, doc_number: ledger.doc_number, totals: ledger.totals },
    );
  }

  const lines = claimable.map(claimFromBudgetLine);
  const money = await resolveMoney(client, { ledger });
  await client.query("BEGIN");
  try {
    await checkProof(client, cr, await replaceLines(client, id, lines));
    await repo.update(client, id, moneyFields(lines, money));
    await audit(client, { actorUserId: actor.user_id || null, action: "cash_request.lines_imported", moduleKey: events.MODULE, entityRef: ref(id), after: { costing_id: cr.costing_id, line_count: lines.length, skipped_exhausted: ledger.lines.length - claimable.length } });
    await client.query("COMMIT");
    return get(client, id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * THE BUDGET GATES (owner decisions Q3, Q4, Q5) — everything that stands
 * between a request and the money, checked in one place so a route, the AI and
 * an import all hit the same wall.
 *
 *   Q5  An OPS request needs an APPROVED_LOCKED costing to be submitted at all.
 *       Refused at SUBMIT rather than later: the lines COME from the costing,
 *       so a request without one is not a request needing a stricter approver,
 *       it is an empty form — and the requester is the person who can fix it.
 *   Q4  Every OPS line must name a budget line. No money leaves without a
 *       costing; unbudgeted spend means amend the costing, not annotate the
 *       request.
 *   Q3  A line claiming more than its budget has left may be SUBMITTED with a
 *       written reason — the reason tells the approver to go and amend the
 *       sheet — and may not be APPROVED. The refusal carries the costing's id
 *       and reference so the screen can offer the unlock in one click.
 *
 * An overhead request has no costing and none of this applies to it; it is
 * governed by its cost centre and its written justification instead.
 */
async function assertFundable(client, cr, { stage, overBudgetReason = null } = {}) {
  if (String(cr.category || "OPS").toUpperCase() !== "OPS") return null;

  if (!cr.costing_id) {
    throw new AppError(
      "NO_COSTING",
      "This request is against an operations file, so it must draw on that file's approved costing. Link the costing before submitting.",
      422,
      { dossier_id: cr.dossier_id },
    );
  }

  // Excluding THIS request: at APPROVE the request is still VALIDATED and so
  // commits nothing, but a re-check on an already-committing request would
  // otherwise measure its claim against a balance it is itself inside.
  const ledger = await costingService.budget(client, cr.costing_id, { excludeCashRequestId: cr.cash_request_id });
  const where = { costing_id: ledger.costing_id, doc_number: ledger.doc_number, costing_status: ledger.status };
  if (!ledger.can_fund) {
    throw new AppError(
      "COSTING_NOT_APPROVED",
      `Costing ${ledger.doc_number || ""} is ${ledger.status} — no cash can be raised against this file until its budget is approved.`.trim(),
      403, where,
    );
  }

  const lines = await repo.listLines(client, cr.cash_request_id);
  if (!lines.length) {
    throw new AppError("NO_LINES", "A cash request needs at least one line", 422, where);
  }

  const unbudgeted = lines.filter((l) => !l.costing_line_id);
  if (unbudgeted.length) {
    throw new AppError(
      "EVERY_LINE_NEEDS_BUDGET",
      `${unbudgeted.length} line(s) are not drawn from the costing. Every spend on an operations file goes through its budget — import the line from costing ${ledger.doc_number || ""}, or request an unlock and add it to the sheet first.`.trim(),
      422,
      { ...where, lines: unbudgeted.map((l) => ({ cash_request_line_id: l.cash_request_line_id, label: l.label })) },
    );
  }

  const breaches = budgetBreaches(lines, ledger.lines);
  if (breaches.length) {
    // At approval this is a refusal; at submission a written reason is enough,
    // because the reason is what tells the approver the sheet needs amending.
    if (stage === "APPROVE") {
      throw new AppError(
        "OVER_BUDGET",
        `This request claims more than costing ${ledger.doc_number || ""} has left on ${breaches.length} line(s). Request an unlock, amend the budget, and approve it — then this can be approved.`.trim(),
        422, { ...where, breaches },
      );
    }
    if (!String(overBudgetReason || "").trim()) {
      throw new AppError(
        "OVER_BUDGET_REASON_REQUIRED",
        `This request claims more than costing ${ledger.doc_number || ""} has left on ${breaches.length} line(s). Say why, and ask for the costing to be unlocked and amended — it cannot be approved until it is.`.trim(),
        422, { ...where, breaches },
      );
    }
  }
  return { ledger, breaches };
}

async function transition(client, { id, to, entityId = null, date = null, reason = null, overBudgetReason = null, actor = {}, viaChain = false }) {
  const cr = await repo.getCR(client, id);
  if (!cr) throw new AppError("NOT_FOUND", "Cash request not found", 404);
  assertTransition(cr.status, to);
  // §3.5 — a request Finance cannot pay out is not ready for Finance: the
  // disbursement method (and its conditional fields, validated when set) must
  // be named before submission, exactly as the legacy screen required at save.
  if (to === "SUBMITTED" && !cr.disbursement_method) {
    throw new AppError("METHOD_REQUIRED", "Pick how the money is to be disbursed (cash, bank, cheque or MoMo) before submitting", 422);
  }
  // 12771 — a rejection with no reason is a status with no explanation, which
  // is the one thing the requester actually needs. The legacy recorded who and
  // when; recording WHY is what makes the reopen below worth having.
  if (to === "REJECTED" && !String(reason || "").trim()) {
    throw new AppError("REJECTION_REASON_REQUIRED", "Say why this request is being rejected — the requester needs to know what to fix", 422);
  }
  // 12771 — the budget gates. Before BEGIN, so a refusal never opens and rolls
  // back a transaction, and re-checked at APPROVE against the ledger as it
  // stands THEN: the sheet may have been amended, or another request approved,
  // in the hours between submission and the decision.
  const budget = to === "SUBMITTED" || to === "APPROVED"
    ? await assertFundable(client, cr, { stage: to === "APPROVED" ? "APPROVE" : "SUBMIT", overBudgetReason })
    : null;
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
    if (to === "SUBMITTED") {
      // Kept whether or not the request breaches: it is the requester's account
      // of the claim, and on a request that is inside its budget it is simply
      // null. Cleared on a reopen (below), because the next attempt is a new one.
      fields.over_budget_reason = String(overBudgetReason || "").trim() || null;
    }
    if (to === "APPROVED") {
      fields.approver_id = actor.user_id || null;
      // The costing had approved_at since 12766 and this did not, so "when was
      // this approved" was answerable only from the audit ledger.
      fields.approved_at = new Date().toISOString();
      // AUDIT ONLY — which revision of the budget this was approved against.
      // The ledger always reads the CURRENT costing line, because amending the
      // budget is exactly how the remaining balance is meant to move.
      if (budget && budget.ledger) fields.costing_revision = budget.ledger.revision;
    }
    if (to === "REJECTED") {
      // DATA 2.4 — FK to app_user, resolved against the schema being written to.
      fields.rejected_by = await resolveActorId(client, actor.user_id);
      fields.rejected_at = new Date().toISOString();
      fields.rejection_reason = String(reason).trim();
      // The legacy cleared the approval stamp on rejection and it was right to:
      // a rejected request that still names an approver reads as both.
      fields.approver_id = null;
      fields.approved_at = null;
    }
    if (to === "DRAFT") {
      // Reopening a rejected request (12771). The rejection stamp STAYS — it is
      // why the request is back on the requester's desk — but the over-budget
      // account does not, because the next submission makes its own case.
      fields.over_budget_reason = null;
    }
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
    if (to === "APPROVED") {
      /*
       * The THIRD leg, and the only optional one (owner Q14). Handing the cash
       * over had no bindable chain — it was a permission and a capability and
       * nothing else — so "over 5 000 000 needs the finance director" could not
       * be expressed as configuration.
       *
       * NOTHING IS BOUND BY DEFAULT (9101 seeds the event, not a workflow), so
       * `start` reports autoApproved and the manual disburse path is unchanged.
       * `onApproved` deliberately does NOT advance on completion: this chain
       * authorises the treasury to act, and the act itself is `disburse`, which
       * moves real money and must stay a deliberate human step.
       */
      await executor.start(client, { eventTypeKey: "disbursal.approved", entityRef: ref(id), amountXaf: updated.amount === null || updated.amount === undefined ? null : Number(updated.amount) });
    }
    /*
     * The seal, LAST — after the row is updated and after the chain is opened,
     * so the payload it hashes is the voucher as the decision left it. Sealing
     * before the update would attest to the status the request was moving OUT
     * of, and the verification portal would show a document whose own seal
     * disagrees with it.
     */
    await seal(client, {
      entityRef: ref(id), docType: "CASH_REQUEST", recordId: id,
      signReason: TRANSITION_SEAL[to], actor,
    });
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

    /*
     * THE RECEIPT FOR THIS INSTALMENT (12773, owner Q16 C).
     *
     * AFTER the status update, never before — the costing's rule, for the
     * costing's reason. `status` is part of the voucher's canonical payload, so
     * a seal applied while the request still read APPROVED would attest to the
     * state it was moving OUT of, and the verification portal would show a
     * document whose own newest seal disagrees with it from the moment the
     * money left.
     *
     * Captured before it is sealed, so the vault row exists for `signInternal`
     * to bind the signature to (it reads `document_vault.getByRef` and stores
     * the artifact hash beside the content hash). The bytes are rendered
     * afterwards, out of band, by the controller — the same shape the voucher
     * has used since the module shipped.
     */
    await documents.capture(client, {
      entityRef: receiptRef(payment.cash_request_payment_id),
      docType: "CASH_PAYMENT_RECEIPT",
      dossierId: cr.dossier_id || null,
      status: "PENDING",
      actor,
    });

    /*
     * TWO SEALS, IN TWO PLACES.
     *
     * The RECEIPT gets one per instalment: this is the document that says what
     * actually changed hands, and each tranche is its own handover.
     *
     * The VOUCHER gets one, and only on the FIRST instalment — the disbursing
     * authority's signature on the request itself. `alreadyPaid` is the total
     * BEFORE this payment (read under the same FOR UPDATE lock), so this is
     * exactly the first tranche and never two of them racing. Without the
     * guard a request paid in three would carry three identical seals and a
     * five-box signature strip.
     */
    await seal(client, {
      entityRef: receiptRef(payment.cash_request_payment_id),
      docType: "CASH_PAYMENT_RECEIPT",
      recordId: payment.cash_request_payment_id,
      signReason: DISBURSE_SEAL,
      actor,
    });
    if (alreadyPaid <= 0) {
      await seal(client, { entityRef: ref(id), docType: "CASH_REQUEST", recordId: id, signReason: DISBURSE_SEAL, actor });
    }

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
    const written = lines.length ? await applySpend(client, id, lines) : [];
    if (lines.length) await checkProof(client, cr, written);

    /*
     * Q17 — ADVISORY EVERYWHERE ELSE, BLOCKING HERE.
     *
     * `checkProof` above raises a compliance flag and notifies; it never
     * throws, and that is right for submit / approve / disburse: a
     * disbursement operations need today must not wait on paperwork that
     * arrives this afternoon. But closing the request is the LAST moment the
     * receipt can still be produced, and a request closed without one is a
     * document owed that nothing will ever ask for again.
     *
     * Read fresh from the database, not from `written`: a justification that
     * carries some of the lines still has to answer for all of them, and the
     * ticks come off the stored rows rather than off the payload — a caller
     * cannot clear an obligation by omitting the line that carries it.
     */
    const stored = await repo.listLines(client, id);
    const owed = stored.filter((l) => l.justification_required === true && !l.proof_vault_id);
    if (owed.length) {
      throw new AppError(
        "PROOF_REQUIRED",
        `${owed.length} line(s) on this request need a supporting document before it can be closed: ${owed.map((l) => l.label).join(", ")}`,
        422,
        { lines: owed.map((l) => ({ cash_request_line_id: l.cash_request_line_id, label: l.label })) },
      );
    }

    const spent = sumField(lines, "spent_amount");
    let retired = null;

    if (cr.regie_advance_id) {
      if (!cr.dossier_id) {
        // A receipt lands in 4731, which is requires_analytic (9001:113) — the
        // ledger trigger would refuse the posting. Fail with the reason rather
        // than letting a raw RAISE surface from inside the transaction.
        throw new AppError(
          "DOSSIER_REQUIRED",
          "This request draws on a régie advance, so it must be attached to an operations file before it can be justified",
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

/**
 * Settle a partly-funded request at what was actually paid, and give the unpaid
 * commitment back to the budget (12771, owner decision Q15).
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Under commitment accounting an APPROVED request holds its whole amount
 * against the costing from the moment it is approved. A request approved for
 * 2 650 000, paid 1 000 000, and then quietly abandoned would hold the other
 * 1 650 000 for ever — so the file reads as fully committed against cash that
 * will never move, and the next legitimate request is refused for want of
 * headroom that does not really exist.
 *
 * `settled_amount` per line is what releases it: the ledger reads
 * COALESCE(settled_amount, claim), so a settled request commits only what it
 * spent. The split is pro-rata because instalments are paid against the
 * request, not against its lines, and the last line absorbs the remainder so
 * the parts sum to the cash actually issued, exactly.
 *
 * A DECISION, NOT A TIMER. It carries `approve` and demands a written reason,
 * the same shape as the régie module's write-off — automating "we are not
 * paying the rest" would be a machine deciding about money.
 */
async function closeBalance(client, { id, reason = null, actor = {} }) {
  if (!String(reason || "").trim()) {
    throw new AppError("REASON_REQUIRED", "Say why the balance of this request is not being paid — it releases budget back to the file", 422);
  }
  const peek = await repo.getCR(client, id);
  if (!peek) throw new AppError("NOT_FOUND", "Cash request not found", 404);
  assertTransition(peek.status, "CLOSED_SHORT");

  await client.query("BEGIN");
  try {
    // Same lock as `disburse`: an instalment landing between the read and the
    // write would leave `settled_amount` describing a smaller payment than the
    // one actually made.
    const cr = await repo.getCRForUpdate(client, id);
    assertTransition(cr.status, "CLOSED_SHORT");
    const paid = await repo.paymentsTotal(client, id);
    const lines = await repo.listLines(client, id);
    const shares = apportionSettlement(lines, paid);

    for (let i = 0; i < lines.length; i += 1) {
       
      await repo.updateLine(client, lines[i].cash_request_line_id, { settled_amount: shares[i] });
    }

    const updated = await repo.update(client, id, {
      status: "CLOSED_SHORT",
      // DATA 2.4 — FK to app_user, resolved against the schema being written to.
      settled_by: await resolveActorId(client, actor.user_id),
      settled_at: new Date().toISOString(),
      settlement_reason: String(reason).trim(),
    });
    const released = round2(Number(cr.amount || 0) - paid);
    await emitEvent(client, { eventTypeKey: events.CLOSED_SHORT, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CLOSED_SHORT, moduleKey: events.MODULE, entityRef: ref(id), before: cr, after: { ...updated, paid, released } });
    await client.query("COMMIT");
    return { ...updated, paid, released_to_budget: released };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * The third signature: the holder acknowledging that they took this tranche
 * (12771, owner decision Q13).
 *
 * ON THE PAYMENT, NOT THE REQUEST, because each tranche is handed over
 * separately — the legacy's single `disbursed_time` on the header is precisely
 * the shape that cannot say who took the second one.
 *
 * The holder, not the beneficiary: `Dr 581 régie (holder) / Cr treasury` puts
 * the money in THEIR hands and `regie.retireCore` reconciles against THEIR
 * receipts, so theirs is the acknowledgement worth recording. Paying an
 * external beneficiary is the SPEND, and it is evidenced at justification.
 *
 * Idempotent by refusal rather than by overwrite: re-acknowledging would move
 * the timestamp of a fact that already happened.
 */
async function acknowledgeReceipt(client, { id, paymentId, ackKind = "IN_APP", receivedBy = null, actor = {} }) {
  const payment = await repo.getPayment(client, paymentId);
  if (!payment || payment.cash_request_id !== id) {
    throw new AppError("NOT_FOUND", "Payment not found on this cash request", 404);
  }
  if (payment.received_at) {
    throw new AppError("ALREADY_ACKNOWLEDGED", "This instalment has already been acknowledged", 409, {
      received_at: payment.received_at,
    });
  }
  const updated = await repo.updatePayment(client, paymentId, {
    // DATA 2.4 — as everywhere else: an id from LIVE beside SANDBOX data raises
    // 23503, and losing an attribution beats losing the acknowledgement.
    received_by: await resolveActorId(client, receivedBy || actor.user_id),
    received_at: new Date().toISOString(),
    received_ack_kind: ackKind,
  });
  /*
   * The receipt's SECOND seal — the person who took the cash (12773).
   *
   * Only on the in-app path. `WET_SCAN` means the acknowledgement is ink on
   * paper that has been matched back to this record; sealing it electronically
   * as well would put a digital signature on the page in the name of somebody
   * who signed with a pen, which is a claim about the evidence that is not
   * true. The `allowsWet` ceiling and the PRINT_SIGN card in the tenant menu
   * are how that path is served instead.
   */
  if (ackKind !== "WET_SCAN") {
    await seal(client, {
      entityRef: receiptRef(paymentId), docType: "CASH_PAYMENT_RECEIPT", recordId: paymentId,
      signReason: RECEIPT_SEAL,
      // The seal is the RECEIVER's, so it must be their session that signs it.
      // `signInternal` takes identity from the actor and nothing from a body
      // (its rule 1), which is exactly why `receivedBy` cannot be used here:
      // acknowledging on somebody else's behalf records the delegation, and
      // must not forge their signature.
      actor,
    });
  }
  await audit(client, { actorUserId: actor.user_id || null, action: events.RECEIPT_ACKNOWLEDGED, moduleKey: events.MODULE, entityRef: ref(id), after: updated });
  return updated;
}

async function get(client, id) {
  const cr = await repo.getCR(client, id);
  if (!cr) return null;
  cr.lines = await repo.listLines(client, id);
  cr.payments = await repo.listPayments(client, id);
  // §3.5 — the voucher footer, derived from the lines on every read.
  cr.totals = computeTotals(cr.lines);
  cr.budget_control = await budgetControlFor(client, cr);
  return cr;
}

/**
 * The budgetary control block a validator and an approver read before they act
 * (12771, owner decision Q20).
 *
 * Finance validates against the budget, so "is this file budgeted for, and is
 * this request inside it?" has to be answerable on the screen the decision is
 * made on — not by opening the costing in another tab and doing arithmetic.
 *
 * Best-effort: a request whose costing has been deleted, or whose ledger read
 * fails, must still OPEN. The block is advisory — every refusal it describes is
 * enforced independently in `assertFundable`, which is what actually stands
 * between the request and the money.
 */
async function budgetControlFor(client, cr) {
  if (String(cr.category || "OPS").toUpperCase() !== "OPS" || !cr.costing_id) return null;
  try {
    const ledger = await costingService.budget(client, cr.costing_id, { excludeCashRequestId: cr.cash_request_id });
    return {
      ...budgetControl({ lines: cr.lines, ledger: ledger.lines, costing: ledger }),
      can_fund: ledger.can_fund,
      currency: ledger.currency,
    };
  } catch (err) {
    // @silent:expected — an unreadable budget must not make the request
    // unreadable. The gates re-derive this on every decision.
    logger.warn({ err: err && err.message, cash_request_id: cr.cash_request_id }, "[cash_request] budget control unavailable");
    return null;
  }
}
const list = (client, q) => repo.list(client, q);
/** The KPI strip, over the SAME filter the page used — see repo.kpis. */
const kpis = (client, q) => repo.kpis(client, q);

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
  if (!cr) return null;
  if (cr.status === "SUBMITTED") return transition(client, { id, to: "VALIDATED", actor: actor || {}, viaChain: true });
  if (cr.status === "VALIDATED") return transition(client, { id, to: "APPROVED", actor: actor || {}, viaChain: true });
  /*
   * An APPROVED request whose `disbursal.approved` chain has just cleared
   * (12771). There is nowhere to advance TO: the next act is `disburse`, which
   * moves real money out of the treasury and stays a deliberate human step.
   * The cleared chain is the authorisation, not the payment.
   */
  return cr;
});

module.exports = {
  createDraft, updateDraft, transition, disburse, justify, importCostingLines,
  closeBalance, acknowledgeReceipt, get, list, kpis,
  /*
   * Exported for the unit tests, not for callers — every writer of lines
   * already goes through `replaceLines`, which applies it.
   *
   * It is here because "the catalogue may tighten the tick, never loosen it"
   * is the whole of Q17's floor, and it inverts silently: swap the condition
   * and every obliged line simply stops being obliged, with no error, no
   * failing gate, and nothing on any screen to notice. A stubbed-client test is
   * the only thing that catches that, and it needs the function.
   */
  applyCatalogueObligations,
};
