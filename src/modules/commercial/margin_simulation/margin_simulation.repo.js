/**
 * Margin-simulation repository (MOD-27). All SQL for the simulator lives here.
 */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insertSim = (client, data) => insertOne(client, "margin_simulation", data);
const getSim = (client, id) => getById(client, "margin_simulation", "margin_simulation_id", id);
const insertLine = (client, data) => insertOne(client, "margin_simulation_line", data);

async function listLines(client, id) {
  const { rows } = await client.query(
    "SELECT * FROM margin_simulation_line WHERE margin_simulation_id = $1 ORDER BY margin_simulation_line_id",
    [id],
  );
  return rows;
}

async function listSims(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = ["1=1"];
  if (q.dossier_id) { params.push(q.dossier_id); wh.push("dossier_id = $" + params.length); }
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  const { rows } = await client.query(
    "SELECT * FROM margin_simulation WHERE " + wh.join(" AND ") + " ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return rows;
}

async function setStatus(client, id, fields) {
  const { rows } = await client.query(
    `UPDATE margin_simulation SET ${fields.sql} WHERE margin_simulation_id = $1 RETURNING *`,
    [id, ...fields.params],
  );
  return rows[0] || null;
}

/** LINK COSTING (§3.1): the costing header + its lines, for import into the
 *  simulator. Any status may be linked — a pricer often prices from a sheet
 *  still in validation — but the response carries the status so the screen
 *  can say so. */
async function costingForLink(client, costingId) {
  const { rows } = await client.query(
    "SELECT costing_id, doc_number, dossier_id, currency, exchange_rate_to_xaf, status FROM costing WHERE costing_id = $1",
    [costingId],
  );
  return rows[0] || null;
}

/**
 * §2.1 — the catalogue's classification travels WITH the line.
 *
 * The costing_line carries its own `is_disbursement` boolean, but that is a
 * copy taken when the line was written and it drifts: a hand-typed line
 * defaults it to false (0320), and nothing re-reads the catalogue afterwards.
 * dictionary_item.direction is the SSOT (0630:77 NOT NULL), so it is joined
 * here and `classifyLine` decides. LEFT JOIN — an ad-hoc line has no
 * dictionary_item_id and must still import, flagged as unclassified.
 */
async function costingLinesForLink(client, costingId) {
  const { rows } = await client.query(
    `SELECT cl.dictionary_item_id, cl.label, cl.qty, cl.unit_cost,
            cl.is_disbursement, cl.tax_code_id,
            di.direction   AS dict_direction,
            di.category    AS dict_category,
            di.is_disbursement AS dict_is_disbursement,
            di.code        AS dict_code
       FROM costing_line cl
       LEFT JOIN dictionary_item di ON di.dictionary_item_id = cl.dictionary_item_id
      WHERE cl.costing_id = $1
      ORDER BY cl.costing_line_id`,
    [costingId],
  );
  return rows;
}

/**
 * The catalogue nature for a set of dictionary items, as { id: {...} }. Used to
 * re-classify lines arriving on create/update, so a client cannot assert a
 * nature the catalogue disagrees with (§2.1).
 */
async function dictionaryNatures(client, ids = []) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return {};
  const { rows } = await client.query(
    `SELECT dictionary_item_id, code, direction, category, is_disbursement
       FROM dictionary_item WHERE dictionary_item_id = ANY($1::uuid[])`,
    [wanted],
  );
  return Object.fromEntries(rows.map((r) => [r.dictionary_item_id, r]));
}

/** Draft editing (§2.4a): lines are replaced wholesale, as the costing does. */
async function deleteLines(client, id) {
  await client.query("DELETE FROM margin_simulation_line WHERE margin_simulation_id = $1", [id]);
}

async function updateSim(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return getSim(client, id);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const { rows } = await client.query(
    `UPDATE margin_simulation SET ${sets.join(", ")} WHERE margin_simulation_id = $1 RETURNING *`,
    [id, ...keys.map((k) => fields[k])],
  );
  return rows[0] || null;
}

/** The tenant's current VAT tax code — used when a quoted line carries the
 *  simulator's per-line VAT toggle (quotation totals only tax lines that name
 *  a tax_code_id). Latest effective VAT code wins. */
async function defaultVatCode(client) {
  const { rows } = await client.query(
    "SELECT tax_code_id FROM tax_code WHERE kind = 'VAT' ORDER BY effective_from DESC LIMIT 1",
  );
  return rows[0] ? rows[0].tax_code_id : null;
}

module.exports = {
  insertSim, getSim, insertLine, listLines, listSims,
  setStatus, updateSim, deleteLines,
  costingForLink, costingLinesForLink, dictionaryNatures, defaultVatCode,
};
