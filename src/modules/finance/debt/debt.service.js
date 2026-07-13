/**
 * Project financing / debt (MOD-53, KB §11) — loans from banks/directors/third
 * parties. createEngagement records the loan; drawdown posts Dr treasury / Cr 162;
 * repay posts Dr 162 (principal) + Dr 671 (interest) / Cr treasury and tracks the
 * outstanding balance; settle closes it. Feature-gated finance.debt (off by
 * default). All SQL is in the repo.
 */
"use strict";

const repo = require("./debt.repo");
const events = require("./debt.events");
const { buildDrawdownLines, buildRepaymentLines } = require("./debt.rules");
const journalEntry = require("../journal_entry/journal_entry.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "debt_engagement:" + id;

async function createEngagement(client, { entityId, dossierId = null, lenderKind, lenderName = null, principal, currency = "XAF", interestRate = null, coaCode = "162", startedOn = null, dueOn = null, actor = {} }) {
  if (!(Number(principal) > 0)) throw new AppError("BAD_PRINCIPAL", "principal must be > 0", 422);
  await client.query("BEGIN");
  try {
    const row = await repo.insertEngagement(client, { entity_id: entityId, dossier_id: dossierId, lender_kind: lenderKind, lender_name: lenderName, principal, currency, interest_rate: interestRate, coa_code: coaCode, status: "ACTIVE", started_on: startedOn, due_on: dueOn });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.debt_engagement_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.debt_engagement_id), after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/** Post the loan drawdown to the GL (Dr treasury / Cr loan-liability). */
async function drawdown(client, { id, entityId, entryDate, sourceDocRef, treasuryCoa = "521", actor = {}, ip = null }) {
  const eng = await repo.getEngagement(client, id);
  if (!eng) throw new AppError("NOT_FOUND", "Debt engagement not found", 404);
  await client.query("BEGIN");
  try {
    const lines = buildDrawdownLines({ principal: Number(eng.principal), treasuryCoa, loanCoa: eng.coa_code || "162" });
    const { entry } = await journalEntry.buildAndInsert(client, {
      journalCode: "BQ", entityId: entityId || eng.entity_id, entryDate,
      description: "Loan drawdown " + (eng.lender_name || eng.lender_kind), sourceDocRef: sourceDocRef || ref(id), source: "SYSTEM_RULE",
      lines, validate: true, actor, ip,
    });
    await audit(client, { actorUserId: actor.user_id || null, action: events.DRAWDOWN, moduleKey: events.MODULE, entityRef: ref(id), after: { entry_id: entry.entry_id } });
    await client.query("COMMIT");
    return { engagement: eng, entry };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/** Record and post a repayment; auto-settle when principal is fully repaid. */
async function repay(client, { id, entityId, entryDate, principalPart = 0, interestPart = 0, treasuryCoa = "521", interestCoa = "671", sourceDocRef, actor = {}, ip = null }) {
  const eng = await repo.getEngagement(client, id);
  if (!eng) throw new AppError("NOT_FOUND", "Debt engagement not found", 404);
  if (eng.status !== "ACTIVE") throw new AppError("NOT_ACTIVE", "Only an ACTIVE engagement can be repaid", 422);
  await client.query("BEGIN");
  try {
    const lines = buildRepaymentLines({ principalPart, interestPart, treasuryCoa, loanCoa: eng.coa_code || "162", interestCoa });
    const { entry } = await journalEntry.buildAndInsert(client, {
      journalCode: "BQ", entityId: entityId || eng.entity_id, entryDate,
      description: "Loan repayment " + (eng.lender_name || eng.lender_kind), sourceDocRef: sourceDocRef || ref(id), source: "SYSTEM_RULE",
      lines, validate: true, actor, ip,
    });
    await repo.insertRepayment(client, { debt_engagement_id: id, principal_part: principalPart, interest_part: interestPart, paid_on: entryDate, entry_id: entry.entry_id });
    const totals = await repo.repaidTotals(client, id);
    let updated = eng;
    if (totals.principal >= Number(eng.principal)) updated = await repo.update(client, id, { status: "SETTLED" });
    await audit(client, { actorUserId: actor.user_id || null, action: events.REPAID, moduleKey: events.MODULE, entityRef: ref(id), after: { entry_id: entry.entry_id, totals } });
    await client.query("COMMIT");
    return { engagement: updated, entry, repaid: totals, outstanding_principal: Math.max(0, Number(eng.principal) - totals.principal) };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/** Edit non-GL metadata (lender/interest/dates/dossier) while ACTIVE. Principal
 *  and COA are immutable once the loan exists — they drive the posted entries. */
async function updateEngagement(client, { id, patch = {}, actor = {} }) {
  const eng = await repo.getEngagement(client, id);
  if (!eng) throw new AppError("NOT_FOUND", "Debt engagement not found", 404);
  if (eng.status !== "ACTIVE") throw new AppError("NOT_ACTIVE", "Only an ACTIVE engagement can be edited", 422);
  await client.query("BEGIN");
  try {
    const fields = {};
    for (const k of ["lender_name", "interest_rate", "due_on", "started_on", "dossier_id"]) if (patch[k] !== undefined) fields[k] = patch[k];
    const row = Object.keys(fields).length ? await repo.update(client, id, fields) : eng;
    await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before: eng, after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/** Delete an engagement created in error — only before any repayment is recorded
 *  (a loan with activity must be settled/reversed, not deleted). */
async function removeEngagement(client, { id, actor = {} }) {
  const eng = await repo.getEngagement(client, id);
  if (!eng) throw new AppError("NOT_FOUND", "Debt engagement not found", 404);
  const totals = await repo.repaidTotals(client, id);
  if (totals.principal > 0 || totals.interest > 0) {
    throw new AppError("HAS_ACTIVITY", "Cannot delete an engagement with recorded repayments — settle it instead", 409);
  }
  await client.query("BEGIN");
  try {
    await repo.remove(client, id);
    await audit(client, { actorUserId: actor.user_id || null, action: events.ARCHIVED, moduleKey: events.MODULE, entityRef: ref(id), before: eng });
    await client.query("COMMIT");
    return { deleted: true };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function get(client, id) {
  const eng = await repo.getEngagement(client, id);
  if (!eng) return null;
  eng.repayments = await repo.listRepayments(client, id);
  eng.repaid = await repo.repaidTotals(client, id);
  eng.outstanding_principal = Math.max(0, Number(eng.principal) - eng.repaid.principal);
  return eng;
}
const list = (client, q) => repo.list(client, q);
module.exports = { createEngagement, drawdown, repay, updateEngagement, removeEngagement, get, list };
