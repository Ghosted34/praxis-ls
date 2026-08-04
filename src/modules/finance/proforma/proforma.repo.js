/**
 * Proforma / customer-advance repository (MOD-50). All `advance` SQL lives here.
 */
"use strict";
const { insertOne, getById, page, TOTAL_COL, splitTotal } = require("../../../shared/db/query-helpers");

const insertAdvance = (client, data) => insertOne(client, "advance", data);
const getAdvance = (client, id) => getById(client, "advance", "advance_id", id);

/**
 * One page of advances, plus how many match the filter in total.
 *
 * `q` searches CLIENT NAME — the field the Finance hub's Proforma tab filters
 * on. It had no text search at all, so the hub filtered names in the browser
 * over a set `page()` had already clamped to 50.
 *
 * @returns {Promise<{rows: Array<object>, total: number}>}
 */
async function listAdvances(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.client_id) { params.push(q.client_id); wh.push("a.client_id = $" + params.length); }
  if (q.dossier_id) { params.push(q.dossier_id); wh.push("a.dossier_id = $" + params.length); }
  if (q.q) { params.push("%" + q.q + "%"); wh.push("c.name ILIKE $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT a.*, ${TOTAL_COL} FROM advance a ` +
      "LEFT JOIN client_master c ON c.client_id = a.client_id " +
      where + " ORDER BY a.created_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return splitTotal(rows);
}

module.exports = { insertAdvance, getAdvance, listAdvances };
