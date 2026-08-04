/**
 * Small SQL builders shared by module repos. Table/column names are always
 * code-provided (never user input); values are parameterised. No ORM.
 */
"use strict";

/** INSERT one row from a plain object → RETURNING *. An empty object inserts a
 *  fully-defaulted row (`DEFAULT VALUES`) rather than emitting the invalid
 *  `() VALUES ()` — lets modules whose columns are all defaulted (e.g. an
 *  outbound order created in status CREATED) be opened with an empty body. */
async function insertOne(client, table, data, returning = "*") {
  const keys = Object.keys(data);
  if (keys.length === 0) {
    const { rows } = await client.query(`INSERT INTO ${table} DEFAULT VALUES RETURNING ${returning}`);
    return rows[0];
  }
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

/**
 * The `COUNT(*) OVER()` column a paged list SELECT adds to report how many rows
 * match the filter BEFORE `LIMIT` truncates them.
 *
 * Why this exists: `page()` above silently clamps every list to 50 rows. A
 * caller that renders the result and filters it in the browser is therefore
 * filtering a truncated set — the Finance hub showed "No invoices match" for
 * invoices that exist, because the match sat at row 80 of 300. Returning the
 * true total alongside the page is what lets a client page through instead of
 * quietly showing a prefix of the data.
 *
 * A window function keeps this to ONE round trip and one WHERE clause. A
 * separate `SELECT COUNT(*)` would duplicate the filter, and the two copies
 * would drift.
 */
const TOTAL_COL = "COUNT(*) OVER() AS _total";

/**
 * Split the window-function total off a paged result set.
 *
 * @param {Array<object>} rows rows from a SELECT that included {@link TOTAL_COL}
 * @returns {{rows: Array<object>, total: number}} rows without `_total`, plus the count
 */
function splitTotal(rows) {
  // No rows means no window-function output to read; the total is genuinely 0.
  if (!rows || rows.length === 0) return { rows: [], total: 0 };
  const total = Number(rows[0]._total) || 0;
  return {
    rows: rows.map(({ _total, ...rest }) => rest),
    total,
  };
}

module.exports = { insertOne, updateOne, getById, page, TOTAL_COL, splitTotal };
