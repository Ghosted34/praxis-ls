/**
 * Smart Receivables (MOD-52, KB §8) — receipts, FIFO allocation, ageing, dunning.
 * Lifecycle: createDraft → post (allocate + Dr cash / Cr 4111 + capture). Ageing
 * and reminder planning are read-only. Business rules (dunning policy, default
 * cash accounts) come from tenant settings. All SQL is in the repo.
 */
"use strict";

const repo = require("./smart_receivables.repo");
const events = require("./smart_receivables.events");
const { ageingBuckets, planAllocation, dunningFor, daysOverdue } = require("./smart_receivables.rules");
const journalEntry = require("../journal_entry/journal_entry.service");
const numbering = require("../../../services/documents/numbering.service");
const documents = require("../../../services/documents/document.service");
const { getSetting } = require("../../../shared/config/settings");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "payment_receipt:" + id;
const CASH_DEFAULT = { CASH: "571", MOBILE_MONEY: "521", BANK: "521", CHEQUE: "521" };

async function createDraft(client, { clientId = null, method = "BANK", treasuryAccountId = null, amount, receivedOn, actor = {} }) {
  if (!(Number(amount) > 0)) throw new AppError("BAD_AMOUNT", "amount must be > 0", 422);
  await client.query("BEGIN");
  try {
    const receipt = await repo.insertReceipt(client, {
      client_id: clientId, method, treasury_account_id: treasuryAccountId, amount,
      received_on: receivedOn || new Date().toISOString().slice(0, 10), status: "DRAFT",
    });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(receipt.receipt_id), after: receipt });
    await client.query("COMMIT");
    return get(client, receipt.receipt_id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function cashCoaFor(client, receipt) {
  if (receipt.treasury_account_id) {
    const coa = await repo.treasuryCoa(client, receipt.treasury_account_id);
    if (coa) return coa;
  }
  return CASH_DEFAULT[receipt.method] || "521";
}

/** Post a DRAFT receipt: FIFO-allocate, Dr cash / Cr 4111 (full amount), capture. */
async function post(client, { receiptId, entityId, entryDate, sourceDocRef, customerAccount = "4111", actor = {}, ip = null }) {
  const receipt = await repo.getReceipt(client, receiptId);
  if (!receipt) throw new AppError("NOT_FOUND", "Receipt not found", 404);
  if (receipt.status !== "DRAFT") throw new AppError("LOCKED", "Only a DRAFT receipt can be posted", 422);

  await client.query("BEGIN");
  try {
    const openInv = await repo.openInvoices(client, { clientId: receipt.client_id });
    const plan = planAllocation(receipt.amount, openInv);
    const cashCoa = await cashCoaFor(client, receipt);

    const { entry } = await journalEntry.buildAndInsert(client, {
      journalCode: "BQ", entityId, entryDate,
      description: "Customer receipt", sourceDocRef: sourceDocRef || ref(receiptId), source: "SYSTEM_RULE",
      lines: [
        { account_code: cashCoa, debit: Number(receipt.amount), credit: 0 },
        { account_code: customerAccount, debit: 0, credit: Number(receipt.amount) },
      ],
      validate: true, actor, ip,
    });

    for (const alloc of plan.allocations) {
      // eslint-disable-next-line no-await-in-loop
      await repo.insertAllocation(client, { receipt_id: receiptId, invoice_id: alloc.invoice_id, amount: alloc.amount });
    }
    const { number } = await numbering.allocate(client, { moduleKey: events.MODULE, entityId, date: entryDate });
    const updated = await repo.updateReceipt(client, receiptId, { status: "POSTED_LOCKED", entry_id: entry.entry_id });
    await documents.capture(client, { entityRef: ref(receiptId), docType: "PAYMENT_RECEIPT", status: "VERIFIED" });
    await emitEvent(client, { eventTypeKey: events.POSTED, moduleKey: events.MODULE, entityRef: ref(receiptId), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.POSTED, moduleKey: events.MODULE, entityRef: ref(receiptId), after: { entry_id: entry.entry_id, doc_number: number, plan } });
    await client.query("COMMIT");
    return { receipt: updated, entry, doc_number: number, allocation: plan };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/** Ageing report — outstanding open invoices bucketed by overdue age. */
async function ageing(client, { clientId = null, asOf = null } = {}) {
  const at = asOf || new Date().toISOString().slice(0, 10);
  const open = await repo.openInvoices(client, { clientId });
  const items = open.map((i) => ({ outstanding: i.outstanding, due_on: i.payment_due_on }));
  return { ...ageingBuckets(items, at), open_count: open.length };
}

/**
 * Overdue detail — the invoice-level companion to `ageing`.
 *
 * Both read the SAME `repo.openInvoices` rows (outstanding = total_ttc net of
 * payment_allocation), so the total returned here is reconcilable with the
 * ageing report's past-due buckets by construction: this total equals
 * d1_30 + d31_60 + d61_90 + d90_plus for the same `asOf`. That's the point —
 * the Control Tower card and its drill-down were previously computed from two
 * different sources (ageing vs raw invoices) and could disagree on screen.
 */
async function overdue(client, { clientId = null, asOf = null } = {}) {
  const at = asOf || new Date().toISOString().slice(0, 10);
  const open = await repo.openInvoices(client, { clientId });
  const invoices = open
    .filter((i) => i.payment_due_on && daysOverdue(i.payment_due_on, at) > 0)
    .map((i) => ({
      invoice_id: i.invoice_id,
      doc_number: i.doc_number,
      client_id: i.client_id,
      total_ttc: Number(i.total_ttc) || 0,
      allocated: Number(i.allocated) || 0,
      outstanding: Number(i.outstanding) || 0,
      payment_due_on: i.payment_due_on,
      days_overdue: daysOverdue(i.payment_due_on, at),
    }))
    .sort((a, b) => b.days_overdue - a.days_overdue);
  // Sum in minor units so repeated float addition can't drift the total away
  // from the ageing report's (which buckets in cents for the same reason).
  const totalMinor = invoices.reduce((s, i) => s + Math.round(i.outstanding * 100), 0);
  return {
    as_of: at,
    total: Math.round(totalMinor) / 100,
    count: invoices.length,
    clients: new Set(invoices.map((i) => i.client_id)).size,
    invoices,
  };
}

/** Reminder plan — which overdue invoices need dunning, at what level. */
async function reminders(client, { asOf = null } = {}) {
  const at = asOf || new Date().toISOString().slice(0, 10);
  const policy = (await getSetting(client, "finance", "receivables_dunning", null)) || [];
  const open = await repo.openInvoices(client, { clientId: null });
  const due = [];
  for (const inv of open) {
    const od = daysOverdue(inv.payment_due_on, at);
    if (od <= 0) continue;
    const step = dunningFor(od, Array.isArray(policy) ? policy : policy.steps || []);
    if (step) due.push({ invoice_id: inv.invoice_id, doc_number: inv.doc_number, client_id: inv.client_id, outstanding: inv.outstanding, days_overdue: od, ...step });
  }
  return { as_of: at, count: due.length, reminders: due };
}

async function get(client, id) {
  const receipt = await repo.getReceipt(client, id);
  if (!receipt) return null;
  receipt.allocations = await repo.allocationsForReceipt(client, id);
  return receipt;
}

const list = (client, q) => repo.listReceipts(client, { clientId: q.client_id, limit: q.limit, offset: q.offset });

module.exports = { createDraft, post, ageing, overdue, reminders, get, list };
