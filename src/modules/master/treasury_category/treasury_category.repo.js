/** treasury_category repository (MOD-09). All SQL lives here. */
"use strict";
const { insertOne, getById, updateOne, page } = require("../../../shared/db/query-helpers");

const WRITABLE = [
  "code", "label", "legacy_kind", "coa_parent_code",
  "requires_custodian", "is_bank_identity", "is_momo_identity",
  "is_system", "is_active", "created_by",
];

const insert = (client, data) => insertOne(client, "treasury_category", data, "*", WRITABLE);
const get    = (client, id)   => getById(client, "treasury_category", "treasury_category_id", id);

async function update(client, id, fields) {
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "treasury_category", "treasury_category_id", id, fields, "*", WRITABLE);
}

async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.is_active !== undefined) {
    params.push(q.is_active === "true" || q.is_active === true);
    wh.push("is_active = $" + params.length);
  }
  if (q.legacy_kind) { params.push(q.legacy_kind); wh.push("legacy_kind = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    "SELECT * FROM treasury_category " + where +
    " ORDER BY is_system DESC, label ASC LIMIT $1 OFFSET $2",
    params,
  );
  return rows;
}

async function getByCode(client, code) {
  const { rows } = await client.query(
    "SELECT * FROM treasury_category WHERE code = $1", [code],
  );
  return rows[0] || null;
}

/** Read a CoA row so the service can validate the parent. */
async function getCoa(client, code) {
  const { rows } = await client.query(
    "SELECT code, class, is_postable, parent_code FROM chart_of_accounts WHERE code = $1", [code],
  );
  return rows[0] || null;
}

/**
 * Count treasury accounts that reference this category. Used by delete —
 * we refuse if the category is in use.
 */
async function countUsage(client, id) {
  const { rows } = await client.query(
    "SELECT COUNT(*)::int AS n FROM treasury_account WHERE category_id = $1", [id],
  );
  return rows[0] ? rows[0].n : 0;
}

async function del(client, id) {
  const { rowCount } = await client.query(
    "DELETE FROM treasury_category WHERE treasury_category_id = $1 AND is_system = false",
    [id],
  );
  return rowCount > 0;
}

module.exports = { insert, get, update, list, getByCode, getCoa, countUsage, del };
