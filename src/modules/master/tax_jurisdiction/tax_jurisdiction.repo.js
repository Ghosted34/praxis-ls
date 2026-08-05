/** Tax-jurisdiction / tax-code repository (MOD-07). All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insertJur = (client, data) => insertOne(client, "tax_jurisdiction", data);
const getJur = (client, id) => getById(client, "tax_jurisdiction", "jurisdiction_id", id);
const insertCode = (client, data) => insertOne(client, "tax_code", data);
const getCode = (client, id) => getById(client, "tax_code", "tax_code_id", id);

async function updateJur(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and writable allow-list in query-helpers.
  if (!Object.keys(fields).length) return getJur(client, id);
  return updateOne(client, "tax_jurisdiction", "jurisdiction_id", id, fields, "*", null);
}
async function updateCode(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and writable allow-list in query-helpers.
  if (!Object.keys(fields).length) return getCode(client, id);
  return updateOne(client, "tax_code", "tax_code_id", id, fields, "*", null);
}
async function codeCount(client, jurisdictionId) {
  const { rows } = await client.query("SELECT COUNT(*)::int AS n FROM tax_code WHERE jurisdiction_id = $1", [jurisdictionId]);
  return rows[0].n;
}
async function codesByKey(client, jurisdictionId, code) {
  const { rows } = await client.query("SELECT * FROM tax_code WHERE jurisdiction_id = $1 AND code = $2 ORDER BY effective_from DESC", [jurisdictionId, code]);
  return rows;
}
async function listCodes(client, jurisdictionId) {
  const { rows } = await client.query("SELECT * FROM tax_code WHERE jurisdiction_id = $1 ORDER BY code, effective_from DESC", [jurisdictionId]);
  return rows;
}
async function listJur(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.country_code) { params.push(q.country_code); wh.push("country_code = $" + params.length); }
  if (q.is_active !== undefined) { params.push(q.is_active === "true" || q.is_active === true); wh.push("is_active = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM tax_jurisdiction " + where + " ORDER BY country_code, name LIMIT $1 OFFSET $2", params);
  return rows;
}
module.exports = { insertJur, getJur, insertCode, getCode, updateJur, updateCode, codeCount, codesByKey, listCodes, listJur };
