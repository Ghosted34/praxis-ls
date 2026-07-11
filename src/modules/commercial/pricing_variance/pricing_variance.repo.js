/** Pricing-variance repository (MOD-27). All SQL lives here. The Sales list
 *  deliberately NEVER selects actual_cost. */
"use strict";
const { insertOne, getById } = require("../../../shared/db/query-helpers");

const SALES_COLS = "pricing_variance_id, dossier_id, quotation_id, quoted_price, variance_percent, flag, computed_at";

const insert = (client, data) => insertOne(client, "pricing_variance", data);
const getFull = (client, id) => getById(client, "pricing_variance", "pricing_variance_id", id);

/** Quoted price (HT) from a quotation. */
async function quotedFor(client, quotationId) {
  const { rows } = await client.query("SELECT total_ht FROM quotation WHERE quotation_id = $1", [quotationId]);
  return rows[0] ? Number(rows[0].total_ht) : null;
}
/** Actual incurred cost for a dossier (posted cost entries). */
async function actualCostFor(client, dossierId) {
  const { rows } = await client.query("SELECT COALESCE(SUM(amount),0) AS c FROM cost_entry WHERE dossier_id = $1", [dossierId]);
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
