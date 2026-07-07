/**
 * Small SQL builders shared by module repos. Table/column names are always
 * code-provided (never user input); values are parameterised. No ORM.
 */
"use strict";

/** INSERT one row from a plain object → RETURNING *. */
async function insertOne(client, table, data, returning = "*") {
  const keys = Object.keys(data);
  const cols = keys.join(", ");
  const params = keys.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await client.query(
    `INSERT INTO ${table} (${cols}) VALUES (${params}) RETURNING ${returning}`,
    keys.map((k) => data[k]),
  );
  return rows[0];
}

/** UPDATE one row by pk from a patch object → RETURNING * (or null if absent). */
async function updateOne(client, table, pk, id, patch, returning = "*") {
  const keys = Object.keys(patch);
  if (keys.length === 0) return getById(client, table, pk, id);
  const set = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  const { rows } = await client.query(
    `UPDATE ${table} SET ${set} WHERE ${pk} = $1 RETURNING ${returning}`,
    [id, ...keys.map((k) => patch[k])],
  );
  return rows[0] || null;
}

async function getById(client, table, pk, id, cols = "*") {
  const { rows } = await client.query(
    `SELECT ${cols} FROM ${table} WHERE ${pk} = $1`,
    [id],
  );
  return rows[0] || null;
}

/** Clamp pagination params. */
function page(q = {}) {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
  return { limit, offset };
}

module.exports = { insertOne, updateOne, getById, page };
