/** Costing repository (MOD-46). costing + costing_line SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "costing", data);
const get = (client, id) => getById(client, "costing", "costing_id", id);

async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "costing", "costing_id", id, fields, "*", null, { touch: "updated_at" });
}
async function deleteLines(client, costingId) { await client.query("DELETE FROM costing_line WHERE costing_id = $1", [costingId]); }
function insertLine(client, data) { return insertOne(client, "costing_line", data); }
// The reader needs the container name to display without a second round-trip,
// and (§2.2) the line's own VAT rate so totals are HT / VAT / TTC — the rate
// comes from the line's tax code, never a hardcoded number. LEFT JOINs because
// most lines have no equipment dimension and DRAFT lines may carry no tax code;
// a deactivated type must still render its name on a five-year-old sheet.
const LINE_SELECT =
  "SELECT cl.*, dr.code AS container_type_code, dr.name_en AS container_type_en, " +
  "dr.name_fr AS container_type_fr, dr.extra AS container_type_extra, " +
  "tc.rate_percent AS tax_rate_percent " +
  "FROM costing_line cl LEFT JOIN dictionary_ref dr ON dr.ref_id = cl.container_type_ref_id " +
  "LEFT JOIN tax_code tc ON tc.tax_code_id = cl.tax_code_id ";
async function listLines(client, costingId) {
  const { rows } = await client.query(LINE_SELECT + "WHERE cl.costing_id = $1 ORDER BY cl.costing_line_id", [costingId]);
  return rows;
}
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset]; const wh = [];
  if (q.dossier_id) { params.push(q.dossier_id); wh.push("dossier_id = $" + params.length); }
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM costing " + where + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}
module.exports = { insert, get, update, deleteLines, insertLine, listLines, list };
