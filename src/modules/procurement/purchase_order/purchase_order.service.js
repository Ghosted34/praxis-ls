/**
 * Purchase order (MOD-60, KB §8.5) — created from an approved PR or standalone.
 * Lifecycle: createDraft → updateDraft → issue (number+lock+capture) → approve →
 * receive (a GRN records receipt) → close. Numbered + captured on issue.
 * All SQL is in the repo.
 */
"use strict";

const repo = require("./purchase_order.repo");
const events = require("./purchase_order.events");
const { assertTransition, computeTotals, netPayable, dueOn, UNLOCK_FLOW, poPayState } = require("./purchase_order.rules");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const numbering = require("../../../services/documents/numbering.service");
const documents = require("../../../services/documents/document.service");
const executor = require("../../../services/workflow/executor");
const onApproved = require("../../../services/workflow/on-approved");
const { assertNoPendingChain } = require("../../../services/workflow/pending-guard");
const compliance = require("../../master/compliance/compliance.service");
const { AppError } = require("../../../utils/errors");
const { assertSupplierUsable } = require("../supplier-eligibility");

const ref = (id) => "purchase_order:" + id;

/** The header fields a PO may carry — the legacy Finance & Treasury screen's
 *  payment block, withholding and advance (see the analysis doc §6.1). */
const HEADER_FIELDS = [
  "supplier_id", "dossier_id", "expense_category", "currency", "delivery_on",
  "delivery_location", "payment_means", "pay_days", "bank_block", "air_rate",
  "adv_paid", "terms", "remarks",
];

async function replaceItems(client, poId, items) {
  await repo.deleteItems(client, poId);
  for (const it of items) {
    /// eslint-disable-next-line no-await-in-loop
    await repo.insertItem(client, { po_id: poId, dictionary_item_id: it.dictionary_item_id || null, label: it.label || "Item", qty: it.qty || 1, unit_price: it.unit_price || 0, tax_code_id: it.tax_code_id || null });
  }
}

/** Recompute and persist HT/VAT/TTC from the current line rows. */
async function refreshTotals(client, poId, items) {
  const rates = await repo.taxRateForItems(client, items.map((i) => i.dictionary_item_id));
  const t = computeTotals(items, (id) => rates[id] || 0);
  const po = await repo.getPO(client, poId);
  const fields = { total_ht: t.total_ht, total_vat: t.total_vat, total_ttc: t.total_ttc };
  if (po && (po.air_rate || po.adv_paid)) fields.net_payable = netPayable({ ...t, air_rate: po.air_rate, adv_paid: po.adv_paid });
  return repo.update(client, poId, fields);
}

async function createDraft(client, { prId = null, supplierId = null, dossierId = null, expenseCategory = "OPERATIONS", items = [], actor = {}, ...header }) {
  // Transactional compliance gate (§5): a hard-blocked supplier cannot receive a
  // PO. Softer states pass (freight moves) — flags show on the supplier 360.
  if (supplierId) {
    await assertSupplierUsable(client, supplierId);
    const gate = await compliance.assertAllowed(client, { kind: "supplier", partyId: supplierId, action: "po_create" });
    if (!gate.allowed) throw new AppError("COMPLIANCE_BLOCKED", gate.reason || "This supplier is hard-blocked.", 409, { blockingFlags: gate.blockingFlags });
  }
  await client.query("BEGIN");
  try {
    const row = { pr_id: prId, supplier_id: supplierId, dossier_id: dossierId, expense_category: expenseCategory, status: "DRAFT", issuer_id: actor.user_id || null };
    for (const k of HEADER_FIELDS) if (header[k] !== undefined && k !== "supplier_id" && k !== "dossier_id" && k !== "expense_category") row[k] = header[k];
    if (header.delivery_on && Number(header.pay_days) > 0) row.due_on = dueOn(header.delivery_on, header.pay_days);
    const po = await repo.insertPO(client, row);
    if (items.length) {
      await replaceItems(client, po.po_id, items);
      await refreshTotals(client, po.po_id, items);
    }
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(po.po_id), after: po });
    await client.query("COMMIT");
    return get(client, po.po_id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function updateDraft(client, { poId, items = null, patch = {}, actor: _actor = {} }) {
  const po = await repo.getPO(client, poId);
  if (!po) throw new AppError("NOT_FOUND", "Purchase order not found", 404);
  if (po.status !== "DRAFT") throw new AppError("LOCKED", "Only a DRAFT purchase order can be edited", 422);
  // Swapping the supplier on a draft is the second way one gets onto a PO.
  if (patch.supplier_id !== undefined) await assertSupplierUsable(client, patch.supplier_id);
  await client.query("BEGIN");
  try {
    const fields = {};
    for (const k of HEADER_FIELDS) if (patch[k] !== undefined) fields[k] = patch[k];
    if (Array.isArray(items)) {
      await replaceItems(client, poId, items);
      await refreshTotals(client, poId, items);
    } else if (Object.keys(fields).length && po.total_ttc !== null && po.total_ttc !== undefined) {
      // Header-only edit (air_rate / adv_paid change) must re-derive net payable
      // from the stored totals; the line table is untouched.
      const t = { total_ht: Number(po.total_ht || 0), total_vat: Number(po.total_vat || 0), total_ttc: Number(po.total_ttc || 0) };
      fields.net_payable = netPayable({ ...t, air_rate: fields.air_rate !== undefined ? fields.air_rate : po.air_rate, adv_paid: fields.adv_paid !== undefined ? fields.adv_paid : po.adv_paid });
    }
    if (fields.delivery_on !== undefined || fields.pay_days !== undefined) {
      const on = fields.delivery_on !== undefined ? fields.delivery_on : po.delivery_on;
      const days = fields.pay_days !== undefined ? fields.pay_days : po.pay_days;
      if (on && Number(days) > 0) fields.due_on = dueOn(on, days); else if (fields.delivery_on !== undefined || fields.pay_days !== undefined) fields.due_on = null;
    }
    if (Object.keys(fields).length) await repo.update(client, poId, fields);
    await client.query("COMMIT");
    return get(client, poId);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function transition(client, { poId, to, entityId = null, date = null, actor = {}, viaChain = false }) {
  const po = await repo.getPO(client, poId);
  if (!po) throw new AppError("NOT_FOUND", "Purchase order not found", 404);
  assertTransition(po.status, to);
  // Approving directly while a chain is live would skip it entirely (W4). Only
  // the approval transition is guarded — issuing, receiving and cancelling are
  // not decisions the chain owns.
  if (to === "APPROVED_LOCKED") {
    await assertNoPendingChain(client, ref(poId), { viaChain, what: "purchase order" });
  }
  await client.query("BEGIN");
  try {
    // A draft may have been created before verification was revoked. Re-check
    // under a row lock at issue time, before allocating a number or capturing.
    if (to === "ISSUED_LOCKED") await assertSupplierUsable(client, po.supplier_id, { required: true, lock: true });
    const fields = { status: to };
    if (to === "ISSUED_LOCKED" && !po.doc_number) {
      if (!entityId) throw new AppError("ENTITY_REQUIRED", "entity_id required to issue (number allocation)", 422);
      const { number } = await numbering.allocate(client, { moduleKey: events.MODULE, entityId, date: date || new Date().toISOString().slice(0, 10) });
      fields.doc_number = number;
      // The document must not change under the supplier after it is issued: the
      // facts it printed are captured here, the same pattern as the transit-order
      // shipment snapshot (0661) and the 0476 line labels.
      const snap = await repo.supplierSnapshot(client, po.supplier_id);
      fields.supplier_name = snap.name || po.supplier_name || null;
      fields.supplier_niu = snap.niu || po.supplier_niu || null;
      // 10721: the full block — a post-issue address change must not alter the
      // printed document, same rule as name/NIU.
      fields.supplier_address = snap.address || po.supplier_address || null;
      fields.supplier_city = snap.city || po.supplier_city || null;
      fields.entity_id = entityId;
      // Net payable is fixed at issue from the agreed terms (TTC − WHT − advance).
      // A PO that never got items has no total yet; leave net_payable null rather
      // than printing a zero that looks like a real settlement.
      if (po.total_ttc !== null && po.total_ttc !== undefined) {
        fields.net_payable = netPayable({ total_ttc: po.total_ttc, total_ht: po.total_ht, air_rate: po.air_rate, adv_paid: po.adv_paid });
      }
    }
    if (to === "APPROVED_LOCKED") fields.approver_id = actor.user_id || null;
    const updated = await repo.update(client, poId, fields);
    if (to === "ISSUED_LOCKED") {
      await documents.capture(client, { entityRef: ref(poId), docType: "PURCHASE_ORDER", status: "VERIFIED" });
      // Open the tenant's configurable approval chain on issue (bound to po.issued).
      // No workflow bound → autoApproved and the manual APPROVED_LOCKED path
      // stays available (see the note on W8 below).
      await executor.start(client, { eventTypeKey: "po.issued", entityRef: ref(poId), amountXaf: updated.total_ttc === null || updated.total_ttc === undefined ? null : Number(updated.total_ttc) });
    }
    await emitEvent(client, { eventTypeKey: events.transition(to), moduleKey: events.MODULE, entityRef: ref(poId), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.transition(to), moduleKey: events.MODULE, entityRef: ref(poId), after: updated });
    await client.query("COMMIT");
    return updated;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

// ── On W8 (autoApproved), and why nothing auto-finalises here ────────────────
//
// `executor.start` returns `{ autoApproved: true }` when no chain applies, and
// this module discards it — which the audit flagged as leaving the record with
// no task to act on and nothing to move it on.
//
// Resolved by W4 rather than by auto-finalising. `assertNoPendingChain` refuses
// the manual approval only while a task is PENDING, so:
//   · a chain exists  → the chain is the only way through, which is the rule the
//                       business asked for;
//   · no chain exists → no task is ever pending, the manual transition works
//                       exactly as before, and the record is not stuck.
//
// Auto-advancing instead would mean "nobody configured a workflow" silently
// becomes "approved by no one" — and for supplier invoices it would post to the
// general ledger unprompted. An ERP should not infer authorisation from the
// absence of configuration. `executor.start` logs every auto-approval so the
// condition stays visible.

/**
 * Pay a PO directly — the legacy po_mark_paid story (10721), for cash/direct
 * purchases that never raise a supplier invoice.
 *
 * DELIBERATELY NO GL POST. Money paid straight on a PO is tracked here
 * (purchase_order_payment + amount_paid, derived from the children); when the
 * purchase goes through the supplier-invoice path instead, THAT is where the
 * accounting happens (Dr 6xx + 4452 / Cr 4011, then /pay Dr 4011 / Cr
 * treasury). Posting twice would book the same outflow twice. For the same
 * reason the supplier payables/overdue cache reflects supplier invoices only —
 * a direct PO payment is expense tracking, not an accounts-payable balance.
 *
 * `amount` is optional and defaults to the whole outstanding balance, so the
 * ordinary full payment is a one-argument call. The status is DERIVED by
 * poPayState from the recomputed Σ of the payment rows — never set by hand.
 */
async function pay(client, { poId, amount = null, paidOn = null, treasuryAccountId = null, note = null, actor = {} }) {
  const po = await repo.getPO(client, poId);
  if (!po) throw new AppError("NOT_FOUND", "Purchase order not found", 404);
  if (!["APPROVED_LOCKED", "PARTIAL", "RECEIVED"].includes(po.status)) {
    throw new AppError("BAD_STATE", `A ${po.status} purchase order cannot be paid`, 422);
  }
  const requested = Number(po.net_payable ?? po.total_ttc ?? 0);
  if (!(requested > 0)) throw new AppError("BAD_AMOUNT", "This purchase order has no payable amount", 422);
  const paidSoFar = await repo.paymentsTotal(client, poId);
  const outstanding = Math.round((requested - paidSoFar) * 100) / 100;
  if (!(outstanding > 0)) throw new AppError("FULLY_PAID", "This purchase order is already paid in full", 422);
  const payAmt = amount === null || amount === undefined ? outstanding : Math.round(Number(amount) * 100) / 100;
  if (!(payAmt > 0)) throw new AppError("BAD_AMOUNT", "payment amount must be > 0", 422);
  const next = poPayState(po.status, requested, paidSoFar + payAmt);
  if (next !== po.status) assertTransition(po.status, next);

  await client.query("BEGIN");
  try {
    await repo.insertPayment(client, {
      po_id: poId,
      amount: payAmt,
      paid_on: paidOn || new Date().toISOString().slice(0, 10),
      treasury_account_id: treasuryAccountId,
      note,
      created_by: await resolveActorId(client, actor.user_id),
    });
    const paidNow = await repo.paymentsTotal(client, poId);
    const fields = { amount_paid: paidNow };
    if (next !== po.status) { fields.status = next; fields.paid_on = paidOn || new Date().toISOString().slice(0, 10); fields.paid_by = await resolveActorId(client, actor.user_id); }
    const updated = await repo.update(client, poId, fields);
    await emitEvent(client, { eventTypeKey: events.PAID, moduleKey: events.MODULE, entityRef: ref(poId), actorUserId: actor.user_id || null, payload: { amount: payAmt, amount_paid: paidNow, status: next } });
    await audit(client, { actorUserId: actor.user_id || null, action: events.PAID, moduleKey: events.MODULE, entityRef: ref(poId), after: { amount: payAmt, amount_paid: paidNow, status: next } });
    await client.query("COMMIT");
    return { purchase_order: updated, amount_paid: paidNow, status: next, outstanding: Math.round((requested - paidNow) * 100) / 100 };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * REQUEST_UNLOCK / UNLOCK / DENY_UNLOCK — the way out of APPROVED_LOCKED,
 * mirrored from costing 10718. The request parks the PO in UNLOCK_REQUESTED so
 * "someone has asked" is visible in the list; the decision returns it to DRAFT
 * (the only status updateDraft edits) or back to APPROVED_LOCKED.
 *
 * Permission split follows costing.routes.js: asking is the issuer's own act
 * (`edit`), granting/refusing is a decision (`approve` + APPROVER).
 */
async function unlockTransition(client, { poId, action, reason = null, actor = {} }) {
  const step = UNLOCK_FLOW[action];
  if (!step) throw new AppError("BAD_ACTION", "unknown unlock action", 422);
  const po = await repo.getPO(client, poId);
  if (!po) throw new AppError("NOT_FOUND", "Purchase order not found", 404);
  if (po.status !== step.from) {
    throw new AppError("BAD_STATE", `${action} needs a purchase order in ${step.from}; this one is ${po.status}`, 422);
  }
  if (action === "REQUEST_UNLOCK" && !String(reason || "").trim()) {
    throw new AppError("REASON_REQUIRED", "Say why the purchase order needs reopening", 422);
  }
  // Checked on the GRANT, not the request: asking is harmless, and the invoice
  // may well be reversed between the two. Same reasoning as costing's
  // assertInvoiceNotPosted — the priced basis cannot change under a posted AP.
  if (action === "UNLOCK") {
    const inv = await repo.postedInvoiceForPO(client, poId);
    if (inv) {
      throw new AppError(
        "INVOICE_POSTED",
        `Supplier invoice ${inv.doc_number || inv.supplier_invoice_id} is ${inv.status}. Reverse it before reopening the purchase order it was matched against.`,
        422,
      );
    }
  }

  await client.query("BEGIN");
  try {
    const patch = { status: step.to };
    if (action === "REQUEST_UNLOCK") {
      // DATA 2.4 — FK to app_user lives in LIVE while this row may land in
      // SANDBOX; resolveActorId returns null instead of raising 23503.
      patch.unlock_requested_by = await resolveActorId(client, actor.user_id);
      patch.unlock_requested_at = new Date().toISOString();
      patch.unlock_reason = reason;
    }
    if (action === "UNLOCK") {
      patch.unlocked_by = await resolveActorId(client, actor.user_id);
      patch.unlocked_at = new Date().toISOString();
    }
    // DENY_UNLOCK keeps the request metadata: a reopening asked for and refused
    // is the audit trail (same as costing).
    const updated = await repo.update(client, poId, patch);
    await emitEvent(client, { eventTypeKey: events.unlockEvent(action), moduleKey: events.MODULE, entityRef: ref(poId), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.unlockEvent(action), moduleKey: events.MODULE, entityRef: ref(poId), before: po, after: updated });
    await client.query("COMMIT");
    return updated;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function get(client, id) {
  const po = await repo.getPO(client, id);
  if (!po) return null;
  po.items = await repo.listItems(client, id);
  po.payments = await repo.listPayments(client, id);
  return po;
}
const list = (client, q) => repo.listPO(client, q);

// A cleared approval chain approves+locks the issued PO (BUILD_CONVENTIONS §2/§5).
onApproved.register("purchase_order", (client, { id, actor }) => transition(client, { poId: id, to: "APPROVED_LOCKED", actor: actor || {}, viaChain: true }));

module.exports = { createDraft, updateDraft, transition, pay, unlockTransition, get, list, assertSupplierUsable };
