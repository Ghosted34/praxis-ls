/**
 * Operational Cost Reconciliation (G19 + §2.1 merge) — the controlled document
 * the legacy `api/ocr/` produced, now also THE record behind the Pricing
 * Variance Index: DRAFT → SUBMITTED → VALIDATED | REJECTED, line-level budget
 * vs actual per costing item, quoted (header-level) from the accepted
 * quotation, a document reference per line, maker-checker (the submitter is
 * never the validator), and the validated amount + status stamped back onto
 * the dossier. Variance % and the R/Y/G flag are DERIVED from this record
 * (pricing_variance module reads it) — never independently stored.
 *
 * AI pre-fill: lines arrive pre-filled with what can be proven (cost entries
 * that name their dictionary item); untagged entries get PROPOSED mappings a
 * human confirms or rejects. The assistant proposes, never confirms.
 */
"use strict";

const repo = require("./dossier_reconciliation.repo");
const rules = require("./dossier_reconciliation.rules");
const { audit } = require("../../../shared/events/emit");
const { getSetting } = require("../../../shared/config/settings");
const { AppError } = require("../../../utils/errors");

const MODULE = "MOD-47";
const ref = (id) => "dossier_reconciliation:" + id;

/** The draft's line set, recomputed from the proven facts. Untagged actuals
 *  land in the UNMATCHED bucket (dictionary_item_id null); everything else is
 *  MATCHED because the cost entry itself named the item. */
async function buildLines(client, dossierId) {
  const compare = await repo.costCompare(client, dossierId);
  const lines = [];
  for (const row of compare) {
    lines.push({
      dictionary_item_id: row.dictionary_item_id,
      item_code: row.item_code,
      item_label: row.item_label,
      budget_ht: Number(row.budget_ht) || 0,
      actual_ht: Number(row.actual_ht) || 0,
      // Lines are service costs only (débours are excluded by costCompare);
      // keep the stored flag false so a reader never has to re-derive that.
      is_disbursement: false,
      doc_ref: null,
      doc_required: await repo.itemRequiresDoc(client, row.dictionary_item_id),
      // Provenance: an actual with no dictionary item cannot be proven onto a
      // line — flag it, and let the matcher propose a mapping below.
      match_status:
        !row.dictionary_item_id && (Number(row.actual_ht) || 0) > 0 ? "UNMATCHED" : "MATCHED",
    });
  }
  return lines;
}

/** Build a DRAFT from the dossier's current costings. One open reconciliation
 *  per dossier: a second draft while one is still SUBMITTED would fork the
 *  story of the file. */
async function createDraft(client, { dossierId, actor = {} }) {
  if (!dossierId) throw new AppError("VALIDATION_ERROR", "dossier_id is required", 422);
  const open = await repo.openForDossier(client, dossierId);
  if (open) {
    throw new AppError("RECON_OPEN", `A ${open.status} reconciliation already exists for this file — validate/reject it first`, 409);
  }
  // Quoted at header level only (§2.1): which quotation the file was won on,
  // and its service revenue HT. May be null — the screen then answers the
  // execution question (budget vs actual) only.
  const quoted = await repo.quotedForDossier(client, dossierId);
  const [lines, disbursement] = await Promise.all([
    buildLines(client, dossierId),
    repo.disbursementTotals(client, dossierId),
  ]);
  // Multi-write: header + lines + suggestions must land together. (The
  // original createDraft wrote header then lines with no transaction — a crash
  // between the two left a lineless reconciliation.)
  await client.query("BEGIN");
  try {
    const row = await repo.insert(client, {
      dossierId,
      actorUserId: actor.user_id || null,
      quotationId: quoted ? quoted.quotation_id : null,
      quotedHt: quoted ? quoted.quoted_ht : null,
    });
    await repo.insertLines(client, row.reconciliation_id, lines);
    // AI pre-fill (§2.1, required): entries that name no item get a PROPOSED
    // mapping the human can confirm. The assistant proposes, never confirms —
    // same rule as MOD-09 bank reconciliation.
    const proposed = await proposeSuggestions(client, row.reconciliation_id, dossierId, lines);
    await audit(client, { actorUserId: actor.user_id || null, action: "dossier_reconciliation.drafted", moduleKey: MODULE, entityRef: ref(row.reconciliation_id), after: { dossier_id: dossierId, lines: lines.length, suggestions: proposed, disbursement_actual_ht: disbursement.actual_ht } });
    await client.query("COMMIT");
    return get(client, row.reconciliation_id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/** Score every untagged cost entry against the costed items and store the
 *  plausible mappings as PROPOSED suggestions. Returns how many were made. */
async function proposeSuggestions(client, reconciliationId, dossierId, lines) {
  const untagged = await repo.untaggedEntries(client, dossierId);
  if (!untagged.length) return 0;
  const candidates = lines.filter((l) => l.dictionary_item_id);
  let made = 0;
  for (const entry of untagged) {
    const best = rules.proposeMapping(
      { category: entry.category, amount: entry.amount },
      candidates,
    );
    if (best) {
      await repo.insertSuggestion(client, {
        reconciliation_id: reconciliationId,
        cost_entry_id: entry.cost_entry_id,
        suggested_dictionary_item_id: best.dictionary_item_id,
        confidence: best.confidence,
        reason: best.reason,
      });
      made += 1;
    }
  }
  return made;
}

/** Round to the column's scale (numeric(18,2)) so the stamped amount matches. */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function get(client, id) {
  const row = await repo.get(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Reconciliation not found", 404);
  const [lines, suggestions, disbursement, thresholds] = await Promise.all([
    repo.lines(client, id),
    repo.suggestions(client, id),
    repo.disbursementTotals(client, row.dossier_id),
    getSetting(client, "commercial", "pricing_variance", null),
  ]);
  // Service-cost lines carry the variance; débours are a separate pass-through
  // total (BUG-3). Both are HT (BUG-2).
  const service_budget_ht = round2(lines.reduce((s, l) => s + (Number(l.budget_ht) || 0), 0));
  const service_actual_ht = round2(lines.reduce((s, l) => s + (Number(l.actual_ht) || 0), 0));
  // The three questions (§2.1): quoted−budget, budget−actual, quoted−actual —
  // one variance block, derived here and NEVER stored independently.
  const variance = rules.computeVarianceBlock(
    { quoted_ht: row.quoted_ht === null || row.quoted_ht === undefined ? null : Number(row.quoted_ht), budget_ht: service_budget_ht, actual_ht: service_actual_ht },
    thresholds || {},
  );
  return {
    ...row,
    lines,
    suggestions,
    variance,
    service_budget_ht,
    service_actual_ht,
    disbursement_budget_ht: round2(disbursement.budget_ht),
    disbursement_actual_ht: round2(disbursement.actual_ht),
    // Total money the file actually cost, including pass-through débours.
    total_actual_ht: round2(service_actual_ht + Number(disbursement.actual_ht || 0)),
  };
}

const latest = (client, { dossierId }) => repo.latestForDossier(client, dossierId);

/** DRAFT → SUBMITTED. The submitter attests the figures are ready for review. */
async function submit(client, { id, actor = {} }) {
  const row = await repo.get(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Reconciliation not found", 404);
  if (row.status !== "DRAFT") throw new AppError("BAD_STATE", `Cannot submit a ${row.status} reconciliation`, 422);
  const lines = await repo.lines(client, id);
  if (!lines.length) throw new AppError("EMPTY_RECON", "Nothing to submit — the file has no costing lines", 422);
  const out = await repo.setStatus(client, id, {
    sql: "status = 'SUBMITTED', submitted_by = $2, submitted_at = now()",
    params: [actor.user_id || null],
  });
  await audit(client, { actorUserId: actor.user_id || null, action: "dossier_reconciliation.submitted", moduleKey: MODULE, entityRef: ref(id), before: { status: row.status }, after: { status: out.status } });
  return out;
}

/** SUBMITTED → VALIDATED. Writes the agreed amount back onto the dossier —
 *  the sign-off that closes the file financially, as in the legacy. The
 *  validator must not be the submitter (maker-checker). */
async function validate(client, { id, actor = {} }) {
  const row = await repo.get(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Reconciliation not found", 404);
  if (row.status !== "SUBMITTED") throw new AppError("BAD_STATE", `Cannot validate a ${row.status} reconciliation`, 422);
  if (row.submitted_by && actor.user_id && row.submitted_by === actor.user_id) {
    throw new AppError("SELF_VALIDATE", "The person who submitted cannot validate — maker-checker", 422);
  }
  // The amount that closes the file financially is total money paid out, so it
  // includes pass-through débours alongside the service actuals (BUG-3). Both
  // are HT (BUG-2) — ocr_amount is the validated actual cost, not a sell price.
  const [lines, disbursement] = await Promise.all([
    repo.lines(client, id),
    repo.disbursementTotals(client, row.dossier_id),
  ]);
  const serviceActual = lines.reduce((s, l) => s + (Number(l.actual_ht) || 0), 0);
  const amount = round2(serviceActual + Number(disbursement.actual_ht || 0));
  const out = await repo.setStatus(client, id, {
    sql: "status = 'VALIDATED', validated_by = $2, validated_at = now(), ocr_amount = $3",
    params: [actor.user_id || null, amount],
  });
  await repo.stampDossier(client, { dossierId: row.dossier_id, reconciliationId: id, amount: out.ocr_amount });
  await audit(client, { actorUserId: actor.user_id || null, action: "dossier_reconciliation.validated", moduleKey: MODULE, entityRef: ref(id), before: { status: row.status }, after: { status: out.status, amount: out.ocr_amount } });
  return out;
}

/** SUBMITTED → REJECTED with a mandatory reason. The dossier keeps no stamp. */
async function reject(client, { id, reason, actor = {} }) {
  if (!reason || !String(reason).trim()) throw new AppError("REASON_REQUIRED", "A rejection needs a reason", 422);
  const row = await repo.get(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Reconciliation not found", 404);
  if (row.status !== "SUBMITTED") throw new AppError("BAD_STATE", `Cannot reject a ${row.status} reconciliation`, 422);
  const out = await repo.setStatus(client, id, {
    sql: "status = 'REJECTED', rejected_by = $2, rejected_at = now(), reject_reason = $3",
    params: [actor.user_id || null, String(reason).trim().slice(0, 2000)],
  });
  await audit(client, { actorUserId: actor.user_id || null, action: "dossier_reconciliation.rejected", moduleKey: MODULE, entityRef: ref(id), before: { status: row.status }, after: { status: out.status, reason: out.reject_reason } });
  return out;
}

/** Human confirms an assistant-proposed mapping (§2.1). DRAFT only — after
 *  submit the figures are attested and must not shift underneath the reviewer.
 *  Confirming stamps the item onto the cost_entry (the analytic tag it was
 *  missing) and rebuilds the draft's lines so the amount moves from the
 *  UNMATCHED bucket onto its item. The assistant can never call this: the
 *  whole meaning of the act is that a person took responsibility. */
async function confirmSuggestion(client, { id, suggestionId, actor = {} }) {
  const { row, suggestion } = await suggestionInState(client, { id, suggestionId });
  await client.query("BEGIN");
  try {
    await repo.setCostEntryItem(client, suggestion.cost_entry_id, suggestion.suggested_dictionary_item_id);
    await repo.decideSuggestion(client, suggestionId, { status: "CONFIRMED", decidedBy: actor.user_id || null });
    // The aggregates changed — rebuild the draft lines from the proven facts.
    // Safe in DRAFT: there is no line-edit API, so no human-entered field is lost.
    await repo.deleteLines(client, id);
    await repo.insertLines(client, id, await buildLines(client, row.dossier_id));
    await audit(client, { actorUserId: actor.user_id || null, action: "dossier_reconciliation.match_confirmed", moduleKey: MODULE, entityRef: ref(id), after: { suggestion_id: suggestionId, cost_entry_id: suggestion.cost_entry_id, dictionary_item_id: suggestion.suggested_dictionary_item_id } });
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK"); throw err; }
  return get(client, id);
}

/** Human rejects a proposed mapping — the entry stays in the UNMATCHED bucket. */
async function rejectSuggestion(client, { id, suggestionId, actor = {} }) {
  const { suggestion } = await suggestionInState(client, { id, suggestionId });
  await repo.decideSuggestion(client, suggestionId, { status: "REJECTED", decidedBy: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: "dossier_reconciliation.match_rejected", moduleKey: MODULE, entityRef: ref(id), after: { suggestion_id: suggestionId, cost_entry_id: suggestion.cost_entry_id } });
  return get(client, id);
}

/** Shared guard: the reconciliation is a DRAFT and the suggestion is its own,
 *  still PROPOSED. */
async function suggestionInState(client, { id, suggestionId }) {
  const row = await repo.get(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Reconciliation not found", 404);
  if (row.status !== "DRAFT") throw new AppError("BAD_STATE", `Cannot decide a match on a ${row.status} reconciliation — matches are settled in DRAFT`, 422);
  const suggestion = await repo.getSuggestion(client, suggestionId);
  if (!suggestion || suggestion.reconciliation_id !== row.reconciliation_id) {
    throw new AppError("NOT_FOUND", "Suggestion not found on this reconciliation", 404);
  }
  if (suggestion.status !== "PROPOSED") {
    throw new AppError("BAD_STATE", `This suggestion was already ${suggestion.status}`, 422);
  }
  return { row, suggestion };
}

module.exports = { createDraft, get, latest, submit, validate, reject, confirmSuggestion, rejectSuggestion };
