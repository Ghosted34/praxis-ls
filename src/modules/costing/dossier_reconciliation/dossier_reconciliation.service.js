/**
 * Operational Cost Reconciliation (G19) — the controlled document the legacy
 * `api/ocr/` produced: DRAFT → SUBMITTED → VALIDATED | REJECTED, line-level
 * budget vs actual per costing item, a document reference per line, maker-
 * checker (the submitter is never the validator), and the validated amount +
 * status stamped back onto the dossier. The old read-only `reconcile` query
 * stays; this is the record layer on top of it.
 */
"use strict";

const repo = require("./dossier_reconciliation.repo");
const { audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const MODULE = "MOD-47";
const ref = (id) => "dossier_reconciliation:" + id;

/** Build a DRAFT from the dossier's current costings. One open reconciliation
 *  per dossier: a second draft while one is still SUBMITTED would fork the
 *  story of the file. */
async function createDraft(client, { dossierId, actor = {} }) {
  if (!dossierId) throw new AppError("VALIDATION_ERROR", "dossier_id is required", 422);
  const open = await repo.openForDossier(client, dossierId);
  if (open) {
    throw new AppError("RECON_OPEN", `A ${open.status} reconciliation already exists for this file — validate/reject it first`, 409);
  }
  const [compare, disbursement] = await Promise.all([
    repo.costCompare(client, dossierId),
    repo.disbursementTotals(client, dossierId),
  ]);
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
    });
  }
  const row = await repo.insert(client, { dossierId, actorUserId: actor.user_id || null });
  await repo.insertLines(client, row.reconciliation_id, lines);
  await audit(client, { actorUserId: actor.user_id || null, action: "dossier_reconciliation.drafted", moduleKey: MODULE, entityRef: ref(row.reconciliation_id), after: { dossier_id: dossierId, lines: lines.length, disbursement_actual_ht: disbursement.actual_ht } });
  return get(client, row.reconciliation_id);
}

/** Round to the column's scale (numeric(18,2)) so the stamped amount matches. */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function get(client, id) {
  const row = await repo.get(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Reconciliation not found", 404);
  const [lines, disbursement] = await Promise.all([
    repo.lines(client, id),
    repo.disbursementTotals(client, row.dossier_id),
  ]);
  // Service-cost lines carry the variance; débours are a separate pass-through
  // total (BUG-3). Both are HT (BUG-2).
  const service_budget_ht = round2(lines.reduce((s, l) => s + (Number(l.budget_ht) || 0), 0));
  const service_actual_ht = round2(lines.reduce((s, l) => s + (Number(l.actual_ht) || 0), 0));
  return {
    ...row,
    lines,
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

module.exports = { createDraft, get, latest, submit, validate, reject };
