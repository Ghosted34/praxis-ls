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
  const compare = await repo.costCompare(client, dossierId);
  const lines = [];
  for (const row of compare) {
    lines.push({
      dictionary_item_id: row.dictionary_item_id,
      item_code: row.item_code,
      item_label: row.item_label,
      budget_ttc: Number(row.budget_ttc) || 0,
      actual_ttc: Number(row.actual_ttc) || 0,
      doc_ref: null,
      doc_required: await repo.itemRequiresDoc(client, row.dictionary_item_id),
    });
  }
  const row = await repo.insert(client, { dossierId, actorUserId: actor.user_id || null });
  await repo.insertLines(client, row.reconciliation_id, lines);
  await audit(client, { actorUserId: actor.user_id || null, action: "dossier_reconciliation.drafted", moduleKey: MODULE, entityRef: ref(row.reconciliation_id), after: { dossier_id: dossierId, lines: lines.length } });
  return get(client, row.reconciliation_id);
}

async function get(client, id) {
  const row = await repo.get(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Reconciliation not found", 404);
  return { ...row, lines: await repo.lines(client, id) };
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
  const lines = await repo.lines(client, id);
  const amount = lines.reduce((s, l) => s + (Number(l.actual_ttc) || 0), 0);
  const out = await repo.setStatus(client, id, {
    sql: "status = 'VALIDATED', validated_by = $2, validated_at = now(), ocr_amount = $3",
    params: [actor.user_id || null, Math.round(amount * 100) / 100],
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
