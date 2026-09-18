/**
 * Office expenses (MOD-77) — review 16 Sep 2026 #37. The office's own running
 * costs (rent, utilities, supplies, connectivity…) recorded as business
 * objects, with GL posting as a separate explicit act.
 *
 * WHY TWO STEPS RATHER THAN POST-ON-CREATE. The person who records the water
 * bill is usually not the person allowed to move money in the ledger — that is
 * the same maker-checker split cash requests carry, expressed here as the
 * `post` route requiring the `approve` action while `create` requires only
 * `create`. A DRAFT is freely editable and deletable; a POSTED row is history
 * (its entry is in the journal) and is corrected by reversal, never by edit.
 *
 * Posting shape: Dr expense_coa (named on the row) / Cr treasury or cash,
 * resolved through finance-accounts by pay method. Feature-gated
 * finance.office_expenses (off by default), same posture as finance.debt.
 */
"use strict";

const repo = require("./office_expense.repo");
const events = require("./office_expense.events");
const { buildExpenseLines } = require("./office_expense.rules");
const journalEntry = require("../journal_entry/journal_entry.service");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { accountFor } = require("../../../shared/config/finance-accounts");

const ref = (id) => "office_expense:" + id;

/** The analytics vocabulary. App-side per the 13791 rule; mirrored in the shared zod + the UI. */
const CATEGORIES = ["RENT", "UTILITIES", "SUPPLIES", "CONNECTIVITY", "MAINTENANCE", "CLEANING", "OTHER"];

async function create(client, { data, actor = {} }) {
  await client.query("BEGIN");
  try {
    const row = await repo.insert(client, {
      entity_id: data.entity_id,
      category: data.category,
      label: data.label,
      supplier_id: data.supplier_id || null,
      expense_date: data.expense_date || undefined,
      amount: data.amount,
      currency: data.currency || "XAF",
      expense_coa: data.expense_coa,
      notes: data.notes || null,
      // created_by REFERENCES app_user(user_id), and identity is pinned to the
      // LIVE schema — a raw id written beside SANDBOX data raises 23503 (DATA
      // 2.4). resolveActorId degrades to null rather than failing the create.
      created_by: await resolveActorId(client, actor.user_id),
    });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.office_expense_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.office_expense_id), after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function update(client, { id, patch = {}, actor = {} }) {
  const row = await repo.get(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Office expense not found", 404);
  if (row.status !== "DRAFT") throw new AppError("ALREADY_POSTED", "A posted expense is corrected by reversing its journal entry, not by editing it", 409);
  await client.query("BEGIN");
  try {
    const fields = {};
    for (const k of ["category", "label", "supplier_id", "expense_date", "amount", "currency", "expense_coa", "notes"]) {
      if (patch[k] !== undefined) fields[k] = patch[k];
    }
    const updated = Object.keys(fields).length ? await repo.update(client, id, fields) : row;
    await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before: row, after: updated });
    await client.query("COMMIT");
    return updated;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * Post to the GL: Dr expense_coa / Cr treasury-or-cash. `paidVia` picks the
 * credit side ('BANK' → treasury role, 'CASH' → cash role); an explicit
 * credit_coa override wins, per the accountFor contract.
 */
async function post(client, { id, entryDate, paidVia = "BANK", creditCoa = null, sourceDocRef, actor = {}, ip = null }) {
  const row = await repo.get(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Office expense not found", 404);
  if (row.status !== "DRAFT") throw new AppError("ALREADY_POSTED", "This expense is already posted", 409);
  const credit = await accountFor(client, paidVia === "CASH" ? "cash" : "treasury", creditCoa);
  await client.query("BEGIN");
  try {
    const lines = buildExpenseLines({ amount: Number(row.amount), expenseCoa: row.expense_coa, creditCoa: credit });
    const { entry } = await journalEntry.buildAndInsert(client, {
      journalCode: paidVia === "CASH" ? "OD" : "BQ",
      entityId: row.entity_id,
      entryDate: entryDate || row.expense_date,
      description: "Office expense — " + row.label,
      sourceDocRef: sourceDocRef || ref(id),
      source: "SYSTEM_RULE",
      lines,
      validate: true,
      actor,
      ip,
    });
    const updated = await repo.update(client, id, { status: "POSTED", entry_id: entry.entry_id });
    await emitEvent(client, { eventTypeKey: events.POSTED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.POSTED, moduleKey: events.MODULE, entityRef: ref(id), after: { entry_id: entry.entry_id } });
    await client.query("COMMIT");
    return { expense: updated, entry };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/** Delete a DRAFT recorded in error. A POSTED row is 409 — reverse the entry instead. */
async function remove(client, { id, actor = {} }) {
  const row = await repo.get(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Office expense not found", 404);
  if (row.status !== "DRAFT") throw new AppError("ALREADY_POSTED", "A posted expense cannot be deleted — reverse its journal entry instead", 409);
  await client.query("BEGIN");
  try {
    await repo.remove(client, id);
    await audit(client, { actorUserId: actor.user_id || null, action: events.DELETED, moduleKey: events.MODULE, entityRef: ref(id), before: row });
    await client.query("COMMIT");
    return { deleted: true };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);
const totals = (client, q) => repo.totals(client, q);

module.exports = { create, update, post, remove, get, list, totals, CATEGORIES };
