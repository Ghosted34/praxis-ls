/**
 * Cost tracking (MOD-47, KB §6.7) — records an ACTUAL cost against a dossier and
 * posts it to the ledger, tagged dossier_id: débours → Dr 4731 (no VAT); own
 * direct cost → Dr <expense from the item's purchase posting_rule> / Cr treasury.
 * Reconciliation compares the approved costing budget vs actual. SQL in the repo.
 */
"use strict";
const repo = require("./cost_tracking.repo");
const events = require("./cost_tracking.events");
const { reconcile } = require("../costing/costing.rules");
const journalEntry = require("../../finance/journal_entry/journal_entry.service");
const proofObligations = require("../../../services/compliance/proof-obligation.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { accountFor } = require("../../../shared/config/finance-accounts");

async function recordCost(client, opts) {
  const {
    dossierId, dictionaryItemId = null, amount, category = null, isDisbursement = false,
    expenseCoa = null, treasuryCoa = null, disbursementAccount = null,
    entityId, entryDate, sourceDocRef, proofVaultId = null, actor = {}, ip = null,
  } = opts;
  if (!(Number(amount) > 0)) throw new AppError("BAD_AMOUNT", "amount must be > 0", 422);
  if (!dossierId) throw new AppError("NO_DOSSIER", "dossierId is required (§6.7 analytical)", 422);

  // Resolved from ('finance','accounts'), NOT a JS literal. The old default was
  // "521", which is_postable=false (9000:77) — assert_line_valid (0640:150)
  // rejected it, so this posting failed whenever the caller did not name an
  // account. An explicit treasury_coa from the request still wins.
  const treasury = await accountFor(client, "treasury", treasuryCoa);
  const disbursement = await accountFor(client, "disbursement", disbursementAccount);

  await client.query("BEGIN");
  try {
    let debitAccount = expenseCoa;
    if (isDisbursement) debitAccount = disbursement;
    else if (!debitAccount) debitAccount = await repo.purchaseRuleAccount(client, dictionaryItemId);
    if (!debitAccount) throw new AppError("NO_EXPENSE_ACCOUNT", "no expense account (pass expenseCoa or map a purchase posting_rule)", 422);

    const { entry } = await journalEntry.buildAndInsert(client, {
      journalCode: "OD", entityId, entryDate,
      description: "Dossier cost" + (category ? " — " + category : ""), sourceDocRef, source: "SYSTEM_RULE",
      lines: [
        { account_code: debitAccount, debit: amount, credit: 0, dossier_id: dossierId, dictionary_item_id: dictionaryItemId, is_disbursement: isDisbursement === true },
        { account_code: treasury, debit: 0, credit: amount, dossier_id: dossierId },
      ],
      validate: true, actor, ip,
    });
    const costEntry = await repo.insertCostEntry(client, {
      dossier_id: dossierId, dictionary_item_id: dictionaryItemId, category, amount, entry_id: entry.entry_id, proof_vault_id: proofVaultId,
    });
    // Advisory proof check (MOD-05 §Q4) — a cost whose dictionary item always
    // requires a receipt, recorded without one, raises a WARN flag and tells the
    // person who recorded it. Never throws and never blocks: the cost IS real
    // and belongs in the ledger today; the paperwork is chased, not gated. See
    // services/compliance/proof-obligation.service for why that is the design.
    await proofObligations.check(client, {
      kind: "cost_entry",
      entityRef: "cost_entry:" + costEntry.cost_entry_id,
      dictionaryItemId,
      proofVaultId,
      requesterUserId: actor.user_id || null,
      amount,
      docLabel: "cost entry",
    });
    await emitEvent(client, { eventTypeKey: events.RECORDED, moduleKey: events.MODULE, entityRef: "dossier:" + dossierId, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.RECORDED, moduleKey: events.MODULE, entityRef: "cost_entry:" + costEntry.cost_entry_id, after: costEntry, ip });
    await client.query("COMMIT");
    return { entry, cost_entry: costEntry };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/**
 * Coverage — how much of what a file has cost is already funded by the client.
 *
 * The legacy answered this with `total_advance`, `total_balance` and
 * `coverage_percentage` on its master view. Restored here as DERIVED fields
 * over the `advance` table rather than a stored column, because the underlying
 * rows already carry the money and a second copy would drift.
 *
 * `coverage_percent` is null rather than 0 when nothing has been spent: 0%
 * would read as "nothing is covered" when the true answer is "there is nothing
 * to cover yet". Same rule reconcile() already applies to variance_percent.
 */
function coverage(actual, advanceReceived) {
  const spent = round2(actual);
  const received = round2(advanceReceived);
  return {
    advance_received: received,
    balance: round2(spent - received),
    coverage_percent: spent ? round2((received / spent) * 100) : null,
  };
}

async function reconcileDossier(client, { dossierId }) {
  const budget = await repo.approvedBudgetTotal(client, dossierId);
  const actual = await repo.actualTotal(client, dossierId);
  // Landing D §4: the one real gap the legacy comparison found — advances were
  // never joined to this read, so a file could not say how much of its cost the
  // client had already funded.
  const adv = await repo.advanceTotals(client, dossierId);
  return {
    dossier_id: dossierId,
    ...reconcile(budget, actual),
    ...coverage(actual, adv.received),
    advance_applied: round2(adv.applied),
  };
}

/**
 * The portfolio sheet: every dossier with a budget or an actual, each row
 * carrying the same reconciliation the single-dossier read returns.
 *
 * The per-row maths is `reconcile` and `coverage` — the SAME functions, not a
 * second SQL implementation of the same arithmetic. That is deliberate: the
 * legacy computed its status in a view AND again in PHP, and the two disagreed
 * (doc/COST_TRACKING_LEGACY_COMPARISON.md §5). One definition, applied twice.
 */
async function portfolio(client, q = {}) {
  const rows = await repo.portfolio(client, q);
  return rows.map((r) => ({
    ...r,
    ...reconcile(r.budget, r.actual),
    ...coverage(r.actual, r.advance_received),
    advance_applied: round2(r.advance_applied),
  }));
}

/** Portfolio-wide KPIs — the legacy's view_cost_tracking_kpis, minus the
 *  status counters it derived from a column this system deliberately lacks. */
async function portfolioKpis(client, q = {}) {
  const rows = await portfolio(client, { ...q, limit: 1000 });
  const sum = (f) => round2(rows.reduce((a, r) => a + Number(r[f] || 0), 0));
  const budget = sum("budget");
  const actual = sum("actual");
  const received = sum("advance_received");
  return {
    files_tracked: rows.length,
    over_budget: rows.filter((r) => r.over_budget).length,
    total_budget: budget,
    total_actual: actual,
    total_variance: round2(actual - budget),
    total_advance_received: received,
    total_balance: round2(actual - received),
    overall_coverage_percent: actual ? round2((received / actual) * 100) : null,
  };
}

const listByDossier = (client, dossierId, q) => repo.listByDossier(client, dossierId, q);

module.exports = { recordCost, reconcileDossier, portfolio, portfolioKpis, listByDossier };
