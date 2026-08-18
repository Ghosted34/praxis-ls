/**
 * Supplier invoice (MOD-61, KB §8.5) — the finance end of procurement.
 * Lifecycle: createDraft → match (three-way PR/PO/GRN/invoice) → post
 * (Dr expense + input-VAT, Cr supplier net of WHT + Cr WHT payable) → capture.
 * Match tolerance is a tenant business rule (settings). All SQL is in the repo.
 */
"use strict";

const repo = require("./supplier_invoice.repo");
const events = require("./supplier_invoice.events");
const { matchThreeWay, buildPostingLines, buildPaymentLines, payState } = require("./supplier_invoice.rules");
const grnService = require("../goods_received/goods_received.service");
const journalEntry = require("../../finance/journal_entry/journal_entry.service");
const numbering = require("../../../services/documents/numbering.service");
const documents = require("../../../services/documents/document.service");
const executor = require("../../../services/workflow/executor");
const onApproved = require("../../../services/workflow/on-approved");
const { assertNoPendingChain } = require("../../../services/workflow/pending-guard");
const { getRule } = require("../../../shared/config/settings");
const { accountFor } = require("../../../shared/config/finance-accounts");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { assertSupplierUsable } = require("../supplier-eligibility");

const ref = (id) => "supplier_invoice:" + id;

async function replaceLines(client, id, lines) {
  await repo.deleteLines(client, id);
  for (const ln of lines) {
     
    // container_type_ref_id (0663) is what makes a carrier invoice reconcilable
    // line-by-line against the rate card it was priced from.
    await repo.insertLine(client, { supplier_invoice_id: id, dictionary_item_id: ln.dictionary_item_id || null, label: ln.label || "Line", qty: ln.qty || 1, unit_price: ln.unit_price || 0, tax_code_id: ln.tax_code_id || null, container_type_ref_id: ln.container_type_ref_id || null, expense_account: ln.expense_account || null });
  }
}

async function createDraft(client, { entityId, supplierId = null, poId = null, grnId = null, dossierId = null, supplierRef = null, currency = "XAF", vatTotal = 0, whtTotal = 0, dueOn = null, lines = [], actor = {} }) {
  await client.query("BEGIN");
  try {
    await assertSupplierUsable(client, supplierId, { required: true, lock: true });
    const si = await repo.insertSI(client, { entity_id: entityId, supplier_id: supplierId, po_id: poId, grn_id: grnId, dossier_id: dossierId, supplier_ref: supplierRef, currency, vat_total: vatTotal, wht_total: whtTotal, due_on: dueOn, status: "DRAFT" });
    if (lines.length) await replaceLines(client, si.supplier_invoice_id, lines);
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(si.supplier_invoice_id), after: si });
    await client.query("COMMIT");
    return get(client, si.supplier_invoice_id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function computeMatch(client, si, lineRows) {
  const invoiceHt = lineRows.reduce((s, l) => s + Number(l.unit_price) * Number(l.qty || 1), 0);
  const tolerance = await getRule(client, "procurement", "three_way_match", "tolerance_percent", 0);
  const po = si.po_id ? await repo.poFacts(client, si.po_id) : null;
  const grnExists = si.po_id ? (await repo.grnCountForPO(client, si.po_id)) > 0 : Boolean(si.grn_id);
  // All of a PO's GRN lines, not just the first note's (a PO can be received in
  // several partial deliveries, each its own GRN).
  const grns = si.po_id ? await grnService.list(client, { po_id: si.po_id }) : [];
  const grnLineRows = [];
  for (const g of grns) { (await grnService.listLines(client, g.grn_id)).forEach((l) => grnLineRows.push({ dictionary_item_id: l.dictionary_item_id, label: l.label, qty: l.received })); }
  const poLines = si.po_id ? await repo.poLineQty(client, si.po_id) : [];
  const prTotal = po && po.pr_id ? await repo.prTotal(client, po.pr_id) : null;
  return matchThreeWay({
    poTotal: (po && po.total_ttc) || 0,
    invoiceTotalHt: invoiceHt,
    grnExists,
    tolerancePercent: tolerance,
    prTotal,
    poLines,
    grnLines: grnLineRows,
    invoiceLines: lineRows.map((l) => ({ dictionary_item_id: l.dictionary_item_id, label: l.label, qty: l.qty || 1 })),
    poCurrency: po && po.currency ? po.currency : "XAF",
    invoiceCurrency: si.currency || "XAF",
  });
}

/** Run the three-way match and record MATCHED (or return reasons). */
async function match(client, { supplierInvoiceId, actor = {} }) {
  const si = await repo.getSI(client, supplierInvoiceId);
  if (!si) throw new AppError("NOT_FOUND", "Supplier invoice not found", 404);
  if (si.status !== "DRAFT") throw new AppError("BAD_STATE", "Only a DRAFT supplier invoice can be matched", 422);
  const lineRows = await repo.listLines(client, supplierInvoiceId);
  const result = await computeMatch(client, si, lineRows);
  await client.query("BEGIN");
  try {
    if (result.matched) {
      await repo.update(client, supplierInvoiceId, { status: "MATCHED" });
      const grns = si.po_id ? await grnService.list(client, { po_id: si.po_id }) : [];
      for (const g of grns) {   await grnService.markMatched(client, g.grn_id, true); }
      // Open the tenant's configurable approval chain on a clean match (bound to
      // supplier_invoice.matched). No workflow bound → autoApproved and the
      // explicit Post step stays available (see the note on W8 below).
      await executor.start(client, { eventTypeKey: "supplier_invoice.matched", entityRef: ref(supplierInvoiceId), amountXaf: result.invoice_total === null || result.invoice_total === undefined ? null : Number(result.invoice_total) });
    }
    await audit(client, { actorUserId: actor.user_id || null, action: events.MATCHED, moduleKey: events.MODULE, entityRef: ref(supplierInvoiceId), after: result });
    await client.query("COMMIT");
    return { supplier_invoice_id: supplierInvoiceId, ...result };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/** Post a MATCHED supplier invoice to the GL and capture the document. */
async function post(client, { supplierInvoiceId, entryDate, sourceDocRef, supplierAccount = "4011", actor = {}, ip = null, viaChain = false }) {
  const si = await repo.getSI(client, supplierInvoiceId);
  if (!si) throw new AppError("NOT_FOUND", "Supplier invoice not found", 404);
  if (!["MATCHED", "DRAFT"].includes(si.status)) throw new AppError("BAD_STATE", "Supplier invoice must be MATCHED to post", 422);
  // Posting IS the approval outcome here, so posting directly while a chain is
  // live would skip it (W4). Before BEGIN so the refusal doesn't open and roll
  // back a transaction.
  await assertNoPendingChain(client, ref(supplierInvoiceId), { viaChain, what: "supplier invoice" });
  const lineRows = await repo.listLines(client, supplierInvoiceId);
  const built = buildPostingLines({ lines: lineRows, vatTotal: si.vat_total, whtTotal: si.wht_total, dossierId: si.dossier_id, supplierAccount });

  await client.query("BEGIN");
  try {
    // Re-check under lock immediately before the first payable/GL side effect.
    // Verification can be revoked after capture or matching.
    await assertSupplierUsable(client, si.supplier_id, { required: true, lock: true });
    const { entry } = await journalEntry.buildAndInsert(client, {
      journalCode: "AC", entityId: si.entity_id, entryDate,
      description: "Supplier invoice " + (si.supplier_ref || si.supplier_invoice_id), sourceDocRef: sourceDocRef || ref(supplierInvoiceId), source: "SYSTEM_RULE",
      lines: built.lines, validate: true, actor, ip,
    });
    const { number } = await numbering.allocate(client, { moduleKey: events.MODULE, entityId: si.entity_id, date: entryDate });
    const updated = await repo.update(client, supplierInvoiceId, { status: "POSTED_LOCKED", doc_number: number, entry_id: entry.entry_id, amount_ht: built.amount_ht, amount_ttc: built.amount_ttc });
    await documents.capture(client, { entityRef: ref(supplierInvoiceId), docType: "SUPPLIER_INVOICE", status: "VERIFIED" });
    await emitEvent(client, { eventTypeKey: events.POSTED, moduleKey: events.MODULE, entityRef: ref(supplierInvoiceId), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.POSTED, moduleKey: events.MODULE, entityRef: ref(supplierInvoiceId), after: { doc_number: number, entry_id: entry.entry_id, totals: built } });
    await client.query("COMMIT");
    return { supplier_invoice: updated, entry, doc_number: number, totals: built };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * Pay a POSTED_LOCKED invoice, in full or in instalments (10720).
 *
 * This is the AP settlement the status CHECK always promised and nothing could
 * ever write: `supplier_invoice.status` has listed PAID since 0342, but there
 * was no payment table, no pay action and no Dr 4011 / Cr 521 posting — the
 * KB's own payment rule (§8.5) was implemented nowhere. The legacy crude
 * equivalent (`po_mark_paid`) at least tracked money on the document.
 *
 * Each instalment posts its own journal (Dr supplier account / Cr treasury) and
 * is recorded on `supplier_invoice_payment`; `amount_paid` is recomputed from
 * the children, never incremented, and the status is DERIVED by `payState`, so
 * the state and the payments can never disagree. `amount` is optional and
 * defaults to the whole outstanding balance — the ordinary full payment.
 */
async function pay(client, { supplierInvoiceId, amount = null, entityId = null, entryDate, treasuryAccountId = null, treasuryCoa = null, note = null, actor = {}, ip = null }) {
  const si = await repo.getSI(client, supplierInvoiceId);
  if (!si) throw new AppError("NOT_FOUND", "Supplier invoice not found", 404);
  if (si.status !== "POSTED_LOCKED") {
    throw new AppError("BAD_STATE", `Only a POSTED_LOCKED supplier invoice can be paid (is ${si.status})`, 422);
  }
  const ttc = Number(si.amount_ttc || 0);
  const paidSoFar = await repo.paymentsTotal(client, supplierInvoiceId);
  const outstanding = Math.round((ttc - paidSoFar) * 100) / 100;
  if (!(outstanding > 0)) throw new AppError("FULLY_PAID", "This supplier invoice is already paid in full", 422);
  const payAmt = amount === null || amount === undefined ? outstanding : Math.round(Number(amount) * 100) / 100;
  if (!(payAmt > 0)) throw new AppError("BAD_AMOUNT", "payment amount must be > 0", 422);
  // Refuse BEFORE any posting, so an over-payment cannot create a journal entry
  // that then has to be reversed.
  const nextStatus = payState(ttc, paidSoFar + payAmt);
  assertSupplierUsable(client, si.supplier_id, { required: true, lock: true });

  // The credit leg: the treasury account's COA code when one was named, else
  // the tenant's configured treasury default (accountFor — never a hard-coded
  // "521", which is not postable; see shared/config/finance-accounts).
  let treasuryCode = treasuryCoa || null;
  if (treasuryAccountId) {
    const { rows } = await client.query("SELECT coa_code FROM treasury_account WHERE treasury_account_id = $1", [treasuryAccountId]);
    if (!rows[0]) throw new AppError("UNKNOWN_TREASURY_ACCOUNT", "Treasury account not found", 404);
    treasuryCode = rows[0].coa_code;
  }
  if (!treasuryCode) treasuryCode = await accountFor(client, "treasury", treasuryCoa);

  const entryEntityId = entityId || si.entity_id;
  if (!entryEntityId) throw new AppError("ENTITY_REQUIRED", "entity_id is required to pay (journal posting)", 422);

  await client.query("BEGIN");
  try {
    const { entry } = await journalEntry.buildAndInsert(client, {
      journalCode: "AC", entityId: entryEntityId, entryDate,
      description: "Payment of supplier invoice " + (si.doc_number || si.supplier_ref || supplierInvoiceId),
      sourceDocRef: "supplier_invoice_payment:" + supplierInvoiceId, source: "SYSTEM_RULE",
      lines: buildPaymentLines({ amount: payAmt, supplierAccount: "4011", treasuryAccount: treasuryCode }),
      validate: true, actor, ip,
    });
    const payment = await repo.insertPayment(client, {
      supplier_invoice_id: supplierInvoiceId,
      treasury_account_id: treasuryAccountId,
      amount: payAmt,
      paid_on: entryDate,
      entry_id: entry.entry_id,
      note,
      created_by: await resolveActorId(client, actor.user_id),
    });
    // Recompute from the children (Landing A's rule) and derive the status.
    const paidNow = await repo.paymentsTotal(client, supplierInvoiceId);
    const updated = await repo.update(client, supplierInvoiceId, { amount_paid: paidNow, status: nextStatus });
    await repo.refreshSupplierCache(client, si.supplier_id);
    await emitEvent(client, { eventTypeKey: "supplier_invoice.paid", moduleKey: events.MODULE, entityRef: ref(supplierInvoiceId), actorUserId: actor.user_id || null, payload: { amount: payAmt, amount_paid: paidNow, status: nextStatus } });
    await audit(client, { actorUserId: actor.user_id || null, action: "supplier_invoice.paid", moduleKey: events.MODULE, entityRef: ref(supplierInvoiceId), after: { amount: payAmt, amount_paid: paidNow, status: nextStatus, entry_id: entry.entry_id } });
    await client.query("COMMIT");
    return { supplier_invoice: updated, payment, amount_paid: paidNow, status: nextStatus, outstanding: Math.round((ttc - paidNow) * 100) / 100 };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * Reverse a posted supplier invoice (10721) — the REVERSED state, listed in
 * the CHECK since 0342, finally has a writer.
 *
 * FROM POSTED_LOCKED: reverses the posting entry (Dr expense+VAT / Cr
 * supplier) with a contra entry via journal_entry.reverse.
 *
 * FROM PAID: additionally reverses every payment's entry (Dr 4011 / Cr
 * treasury), so a paid invoice can be fully unwound — the user's decision of
 * 2026-08-18. The payment ROWS are kept as the audit trail and `amount_paid`
 * stays derived from them (the invariant is never broken); the ledger is what
 * gets the contra entries, and the payables cache drops the invoice because
 * REVERSED is excluded from it.
 */
async function reverse(client, { supplierInvoiceId, reason = null, entryDate = null, actor = {}, ip = null }) {
  const si = await repo.getSI(client, supplierInvoiceId);
  if (!si) throw new AppError("NOT_FOUND", "Supplier invoice not found", 404);
  if (!["POSTED_LOCKED", "PAID"].includes(si.status)) {
    throw new AppError("BAD_STATE", `Only a POSTED_LOCKED or PAID supplier invoice can be reversed (is ${si.status})`, 422);
  }
  // Reversing is the most consequential thing done to a closed record — the
  // approval chain must not be mid-flight (journal_entry.reverse has the same
  // caution, OBS L2).
  await assertNoPendingChain(client, ref(supplierInvoiceId), { viaChain: false, what: "supplier invoice" });
  const date = entryDate || new Date().toISOString().slice(0, 10);

  await client.query("BEGIN");
  try {
    // 1. The posting entry itself (Dr expense + VAT / Cr supplier + WHT).
    if (si.entry_id) {
      await journalEntry.reverse(client, { entryId: si.entry_id, reason: reason || ("Reversed supplier invoice " + (si.doc_number || si.supplier_ref || supplierInvoiceId)), entryDate: date, actor, ip });
    }
    // 2. If money moved, each payment's entry too — the full unwind.
    const payments = await repo.listPayments(client, supplierInvoiceId);
    for (const p of payments) {
      if (p.entry_id) {
        /// eslint-disable-next-line no-await-in-loop
        await journalEntry.reverse(client, { entryId: p.entry_id, reason: reason || ("Reversed payment of supplier invoice " + (si.doc_number || supplierInvoiceId)), entryDate: date, actor, ip });
      }
    }
    const updated = await repo.update(client, supplierInvoiceId, {
      status: "REVERSED",
      reversed_at: new Date().toISOString(),
      reversed_by: await resolveActorId(client, actor.user_id),
      reversal_reason: reason || null,
    });
    await repo.refreshSupplierCache(client, si.supplier_id);
    await emitEvent(client, { eventTypeKey: events.REVERSED, moduleKey: events.MODULE, entityRef: ref(supplierInvoiceId), actorUserId: actor.user_id || null, payload: { reason, reversed_entry: si.entry_id, payments_reversed: payments.filter((p) => p.entry_id).length } });
    await audit(client, { actorUserId: actor.user_id || null, action: events.REVERSED, moduleKey: events.MODULE, entityRef: ref(supplierInvoiceId), before: si, after: updated });
    await client.query("COMMIT");
    return updated;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function get(client, id) {
  const si = await repo.getSI(client, id);
  if (!si) return null;
  si.lines = await repo.listLines(client, id);
  si.payments = await repo.listPayments(client, id);
  return si;
}
const list = (client, q) => repo.listSI(client, q);

// A cleared approval chain posts the matched supplier invoice (BUILD_CONVENTIONS §2/§5).
onApproved.register("supplier_invoice", (client, { id, actor }) =>
  post(client, { supplierInvoiceId: id, entryDate: new Date().toISOString().slice(0, 10), sourceDocRef: "approval:" + id, actor: actor || {}, viaChain: true }));

module.exports = { createDraft, match, post, pay, reverse, get, list };
