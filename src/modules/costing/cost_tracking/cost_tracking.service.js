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
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

async function recordCost(client, opts) {
  const {
    dossierId, dictionaryItemId = null, amount, category = null, isDebours = false,
    expenseCoa = null, treasuryCoa = "521", deboursAccount = "4731",
    entityId, entryDate, sourceDocRef, proofVaultId = null, actor = {}, ip = null,
  } = opts;
  if (!(Number(amount) > 0)) throw new AppError("BAD_AMOUNT", "amount must be > 0", 422);
  if (!dossierId) throw new AppError("NO_DOSSIER", "dossierId is required (§6.7 analytical)", 422);

  await client.query("BEGIN");
  try {
    let debitAccount = expenseCoa;
    if (isDebours) debitAccount = deboursAccount;
    else if (!debitAccount) debitAccount = await repo.purchaseRuleAccount(client, dictionaryItemId);
    if (!debitAccount) throw new AppError("NO_EXPENSE_ACCOUNT", "no expense account (pass expenseCoa or map a purchase posting_rule)", 422);

    const { entry } = await journalEntry.buildAndInsert(client, {
      journalCode: "OD", entityId, entryDate,
      description: "Dossier cost" + (category ? " — " + category : ""), sourceDocRef, source: "SYSTEM_RULE",
      lines: [
        { account_code: debitAccount, debit: amount, credit: 0, dossier_id: dossierId, dictionary_item_id: dictionaryItemId, is_debours: isDebours === true },
        { account_code: treasuryCoa, debit: 0, credit: amount, dossier_id: dossierId },
      ],
      validate: true, actor, ip,
    });
    const costEntry = await repo.insertCostEntry(client, {
      dossier_id: dossierId, dictionary_item_id: dictionaryItemId, category, amount, entry_id: entry.entry_id, proof_vault_id: proofVaultId,
    });
    await emitEvent(client, { eventTypeKey: events.RECORDED, moduleKey: events.MODULE, entityRef: "dossier:" + dossierId, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.RECORDED, moduleKey: events.MODULE, entityRef: "cost_entry:" + costEntry.cost_entry_id, after: costEntry, ip });
    await client.query("COMMIT");
    return { entry, cost_entry: costEntry };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function reconcileDossier(client, { dossierId }) {
  const budget = await repo.approvedBudgetTotal(client, dossierId);
  const actual = await repo.actualTotal(client, dossierId);
  return { dossier_id: dossierId, ...reconcile(budget, actual) };
}

const listByDossier = (client, dossierId, q) => repo.listByDossier(client, dossierId, q);

module.exports = { recordCost, reconcileDossier, listByDossier };
