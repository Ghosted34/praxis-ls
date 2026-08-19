/** Pricing-variance repository (MOD-27). All SQL lives here. The Sales list
 *  deliberately NEVER selects actual_cost. */
"use strict";
const { insertOne, getById } = require("../../../shared/db/query-helpers");

const SALES_COLS = "pricing_variance_id, dossier_id, quotation_id, quoted_price, variance_percent, flag, computed_at";

const insert = (client, data) => insertOne(client, "pricing_variance", data);
const getFull = (client, id) => getById(client, "pricing_variance", "pricing_variance_id", id);

/** Quoted price, SERVICE ONLY and HT, from a quotation's lines.
 *
 * `quotation.total_ht` (0345:18) INCLUDES débours lines (quotation.rules
 * computeTotals sums every line), but the margin base must compare service
 * revenue to service cost (OHADA_KB §6.7/§450 — débours are pass-through).
 * Summing the non-disbursement lines here keeps the two bases apples-to-apples.
 * BUG-3. */
async function quotedFor(client, quotationId) {
  const { rows } = await client.query(
    "SELECT COALESCE(SUM(qty * unit_price),0) AS c FROM quotation_line WHERE quotation_id = $1 AND COALESCE(is_disbursement, false) = false",
    [quotationId],
  );
  return rows[0] ? Number(rows[0].c) : null;
}
/** Actual incurred SERVICE cost for a dossier (posted cost entries).
 *
 * Débours are excluded (BUG-3): cost_entry has no flag of its own, so the
 * item's dictionary flag is the authority — the same flag assert_line_valid()
 * enforces on the ledger posting. An entry with no dictionary item is an
 * own-cost, never a débours. */
async function actualCostFor(client, dossierId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(ce.amount),0) AS c
       FROM cost_entry ce
       LEFT JOIN dictionary_item di ON di.dictionary_item_id = ce.dictionary_item_id
      WHERE ce.dossier_id = $1 AND COALESCE(di.is_disbursement, false) = false`,
    [dossierId],
  );
  return Number(rows[0].c);
}
/** Sales list — R/Y/G only, no cost. Latest per dossier first. */
async function listSales(client, { dossierId = null, flag = null, limit = 50, offset = 0 }) {
  const params = [Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200), Math.max(parseInt(offset, 10) || 0, 0)];
  const wh = [];
  if (dossierId) { params.push(dossierId); wh.push("dossier_id = $" + params.length); }
  if (flag) { params.push(flag); wh.push("flag = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    "SELECT " + SALES_COLS + " FROM pricing_variance " + where + " ORDER BY computed_at DESC LIMIT $1 OFFSET $2", params,
  );
  return rows;
}
const getSales = async (client, id) => {
  const { rows } = await client.query("SELECT " + SALES_COLS + " FROM pricing_variance WHERE pricing_variance_id = $1", [id]);
  return rows[0] || null;
};

module.exports = { insert, getFull, quotedFor, actualCostFor, listSales, getSales };
