/** Rate provider repository (MOD-10) — carriers and rate-setting authorities. */
"use strict";
const { insertOne, updateOne, getById, page } = require("../../../shared/db/query-helpers");

const WRITABLE = ["kind", "code", "name", "carrier_code", "sort_order", "is_active"];
const insert = (client, data) => insertOne(client, "rate_provider", data, "*", WRITABLE);
const get = (client, id) => getById(client, "rate_provider", "rate_provider_id", id);
const update = (client, id, patch) => updateOne(client, "rate_provider", "rate_provider_id", id, patch, "*", WRITABLE);

async function list(client, q = {}) {
  const { limit, offset } = page({ ...q, limit: q.limit || 200 });
  const params = [limit, offset];
  const wh = [];
  if (q.kind) { params.push(String(q.kind).toUpperCase()); wh.push("kind = $" + params.length); }
  if (q.active !== undefined) { params.push(q.active === "true" || q.active === true); wh.push("is_active = $" + params.length); }
  if (q.q) { params.push(`%${q.q}%`); wh.push(`(code::text ILIKE $${params.length} OR name ILIKE $${params.length})`); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT * FROM rate_provider ${where} ORDER BY kind, sort_order, name LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

module.exports = { insert, get, update, list };
