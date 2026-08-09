/** Compliance-checker repository (MOD-65). The rule scans + flag persistence.
 *  Each scan returns [{ entity_ref, message }] of offenders. All SQL is here. */
"use strict";
const { insertOne } = require("../../../shared/db/query-helpers");
// One sentence for the flag and the notification, shared with the inline hook so
// a user never sees two differently-worded versions of the same warning.
const { proofMessage } = require("../../master/financial_dictionary/financial_dictionary.rules");

const SCANS = {
  "cost_entry.missing_proof": async (client) => {
    const { rows } = await client.query(
      "SELECT cost_entry_id, dossier_id, amount FROM cost_entry WHERE proof_vault_id IS NULL AND amount > 0",
    );
    return rows.map((r) => ({ entity_ref: "cost_entry:" + r.cost_entry_id, message: "No proof for cost entry (" + r.amount + ") on dossier " + r.dossier_id }));
  },
  "procurement.unmatched": async (client) => {
    const { rows } = await client.query(
      "SELECT si.supplier_invoice_id FROM supplier_invoice si " +
        "LEFT JOIN goods_received_note g ON g.po_id = si.po_id AND g.three_way_matched = true " +
        "WHERE si.status = 'POSTED_LOCKED' AND g.grn_id IS NULL",
    );
    return rows.map((r) => ({ entity_ref: "supplier_invoice:" + r.supplier_invoice_id, message: "Posted supplier invoice without a matched GRN" }));
  },
  "regie.aged_unjustified": async (client) => {
    const { rows } = await client.query("SELECT regie_advance_id, amount FROM regie_advance WHERE state = 'AGED_UNJUSTIFIED'");
    return rows.map((r) => ({ entity_ref: "regie_advance:" + r.regie_advance_id, message: "Aged unjustified advance (" + r.amount + ")" }));
  },
  "debours.tax_violation": async (client) => {
    const { rows } = await client.query("SELECT line_id, entry_id FROM journal_line WHERE is_debours = true AND tax_code_id IS NOT NULL");
    return rows.map((r) => ({ entity_ref: "journal_line:" + r.line_id, message: "Débours line carries a tax code (entry " + r.entry_id + ")" }));
  },

  /* ── Dictionary-driven proof obligations (MOD-05 §Q4) ─────────────────────
   * The batch counterpart of the inline raise in
   * services/compliance/proof-obligation.service. Both exist, and they are not
   * redundant: the inline hook catches the document as it is written (when the
   * receipt can still be fetched), and this sweep catches everything that
   * predates the hook, was imported, or was written by a path that does not go
   * through the service yet. Same rule keys, so a re-scan reconciles rather
   * than duplicating.
   *
   * `receipt_requirement = 'ALWAYS_REQUIRED' OR requires_justification` mirrors
   * rules.proofObligation exactly — CONDITIONALLY_REQUIRED is deliberately not
   * an obligation, because "it depends" cannot be decided from the catalogue
   * row and a flag raised on a maybe is noise. */
  "dictionary.proof_missing.cash_request": async (client) => {
    const { rows } = await client.query(
      `SELECT crl.cash_request_line_id, crl.budget_amount, cr.requested_by, cr.doc_number,
              di.dictionary_item_id, di.code, di.label_fr, di.label_en, di.receipt_requirement, di.proof_source
         FROM cash_request_line crl
         JOIN cash_request cr   ON cr.cash_request_id = crl.cash_request_id
         JOIN dictionary_item di ON di.dictionary_item_id = crl.dictionary_item_id
        WHERE crl.proof_vault_id IS NULL
          AND cr.status IN ('SUBMITTED','APPROVED','DISBURSED','JUSTIFIED')
          AND (di.receipt_requirement = 'ALWAYS_REQUIRED' OR di.requires_justification = true)`,
    );
    return rows.map((r) => ({
      entity_ref: "cash_request_line:" + r.cash_request_line_id,
      message: proofMessage(r, { docLabel: "cash request " + (r.doc_number || "(draft)"), amount: r.budget_amount }),
      dictionary_item_id: r.dictionary_item_id,
      subject_user_id: r.requested_by || null,
    }));
  },
  "dictionary.proof_missing.cost_entry": async (client) => {
    const { rows } = await client.query(
      `SELECT ce.cost_entry_id, ce.amount, ce.dossier_id,
              di.dictionary_item_id, di.code, di.label_fr, di.label_en, di.receipt_requirement, di.proof_source
         FROM cost_entry ce
         JOIN dictionary_item di ON di.dictionary_item_id = ce.dictionary_item_id
        WHERE ce.proof_vault_id IS NULL
          AND (di.receipt_requirement = 'ALWAYS_REQUIRED' OR di.requires_justification = true)`,
    );
    return rows.map((r) => ({
      entity_ref: "cost_entry:" + r.cost_entry_id,
      message: proofMessage(r, { docLabel: "cost entry on dossier " + r.dossier_id, amount: r.amount }),
      dictionary_item_id: r.dictionary_item_id,
      subject_user_id: null, // cost_entry names no requester; the dossier owner is MOD-47's to resolve
    }));
  },
};

const scan = (client, ruleKey) => (SCANS[ruleKey] ? SCANS[ruleKey](client) : Promise.resolve([]));

const insertFlag = (client, data) => insertOne(client, "compliance_flag", data);
async function clearOpenByRule(client, ruleKey) {
  await client.query("DELETE FROM compliance_flag WHERE rule_key = $1 AND resolved_at IS NULL", [ruleKey]);
}
async function listFlags(client, { severity = null, includeResolved = false } = {}) {
  const params = []; const wh = [];
  if (!includeResolved) wh.push("resolved_at IS NULL");
  if (severity) { params.push(severity); wh.push("severity = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM compliance_flag " + where + " ORDER BY severity DESC, created_at DESC", params);
  return rows;
}
async function resolveFlag(client, id) {
  const { rows } = await client.query("UPDATE compliance_flag SET resolved_at = now() WHERE flag_id = $1 AND resolved_at IS NULL RETURNING *", [id]);
  return rows[0] || null;
}

module.exports = { scan, insertFlag, clearOpenByRule, listFlags, resolveFlag };
