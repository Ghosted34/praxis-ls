/** Compliance-checker repository (MOD-65). The rule scans + flag persistence.
 *  Each scan returns [{ entity_ref, message }] of offenders. All SQL is here. */
"use strict";
const { insertOne } = require("../../../shared/db/query-helpers");

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
