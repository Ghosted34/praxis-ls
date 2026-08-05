/**
 * Small SQL builders shared by module repos. Values are parameterised. No ORM.
 *
 * SEC H3 (High). This file's header used to assert "Table/column names are
 * always code-provided (never user input)". THAT WAS NOT TRUE, and the
 * assertion is why nobody looked.
 *
 * `insertOne`/`updateOne` build their column list from `Object.keys(data)`.
 * That is safe for a module with a zod validator, because `z.object` strips
 * unknown keys and the middleware reassigns `req.body = p.data`. It is not safe
 * for the ten modules on `passthrough`, which was a pair of no-op middlewares:
 * `makeController.create/update` handed `req.body` through untouched.
 *
 * Two defects followed. MASS ASSIGNMENT: any column of the target table could
 * be written, so a holder of MOD-67 `edit` could clear `killed_at` on a revoked
 * session — resurrecting an administrator session security staff believed they
 * had terminated — or repoint a session's `user_id`. IDENTIFIER INJECTION: the
 * keys were concatenated with no quoting or validation, so a key WAS a SQL
 * fragment, turning a tenant-admin grant into arbitrary SQL on the tenant
 * database under the shared application role.
 *
 * Three layers now, because either one alone leaves a gap:
 *
 *   1. every identifier is validated against a strict pattern and rejected if
 *      it does not match — this is what closes injection, and it cannot be
 *      forgotten by a module author because it lives here;
 *   2. every identifier is double-quoted, so even a valid-but-reserved word
 *      behaves;
 *   3. `makeRepo` may declare `writable`, an explicit allow-list, which closes
 *      mass assignment independently of injection.
 */
"use strict";

const { AppError } = require("../../utils/errors");

/**
 * A bare SQL identifier: letter or underscore, then letters, digits,
 * underscores. Deliberately NARROWER than Postgres allows — no dollar signs, no
 * unicode, no embedded quotes, 63 chars (Postgres's own NAMEDATALEN limit).
 *
 * Every column name in this schema fits it. Anything that does not is either a
 * mistake or an attack, and both should stop here.
 */
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/**
 * Validate and quote one identifier.
 *
 * Quoting alone is NOT sufficient — a key containing a double quote would
 * escape it — which is why the pattern check comes first and the two are done
 * together in one place that cannot be bypassed.
 */
function ident(name, ctx) {
  if (typeof name !== "string" || !IDENT_RE.test(name)) {
    throw new AppError(
      "INVALID_FIELD",
      `"${String(name).slice(0, 40)}" is not a valid column name`,
      422,
      { [ctx || "body"]: [`unrecognised field "${String(name).slice(0, 40)}"`] },
    );
  }
  return `"${name}"`;
}

/**
 * Reject any key outside the allow-list, when one is declared.
 *
 * Rejecting rather than silently dropping: a caller who sends `killed_at`
 * should be told the field is not writable, not have it quietly ignored while
 * the response looks successful. Silent dropping is how F-16's unknown-filter
 * bug went unnoticed for so long.
 */
function assertWritable(keys, allow, table) {
  if (!allow) return;
  const set = allow instanceof Set ? allow : new Set(allow);
  const bad = keys.filter((k) => !set.has(k));
  if (bad.length) {
    throw new AppError(
      "FIELD_NOT_WRITABLE",
      `${bad.length === 1 ? "Field" : "Fields"} ${bad.map((b) => `"${b}"`).join(", ")} cannot be written on ${table}`,
      422,
      bad.reduce((a, b) => ({ ...a, [b]: ["not a writable field"] }), {}),
    );
  }
}

/** INSERT one row from a plain object → RETURNING *. An empty object inserts a
 *  fully-defaulted row (`DEFAULT VALUES`) rather than emitting the invalid
 *  `() VALUES ()` — lets modules whose columns are all defaulted (e.g. an
 *  outbound order created in status CREATED) be opened with an empty body. */
async function insertOne(client, table, data, returning = "*", allow = null) {
  const keys = Object.keys(data);
  if (keys.length === 0) {
    const { rows } = await client.query(`INSERT INTO ${table} DEFAULT VALUES RETURNING ${returning}`);
    return rows[0];
  }
  assertWritable(keys, allow, table);
  const cols = keys.map((k) => ident(k)).join(", ");
  const params = keys.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await client.query(
    `INSERT INTO ${table} (${cols}) VALUES (${params}) RETURNING ${returning}`,
    keys.map((k) => data[k]),
  );
  return rows[0];
}

/** UPDATE one row by pk from a patch object → RETURNING * (or null if absent). */
async function updateOne(client, table, pk, id, patch, returning = "*", allow = null) {
  const keys = Object.keys(patch);
  if (keys.length === 0) return getById(client, table, pk, id);
  assertWritable(keys, allow, table);
  const set = keys.map((k, i) => `${ident(k)} = $${i + 2}`).join(", ");
  const { rows } = await client.query(
    `UPDATE ${table} SET ${set} WHERE ${ident(pk)} = $1 RETURNING ${returning}`,
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

/**
 * Run a list query that must return EVERY matching row, with a ceiling that
 * fails loudly instead of truncating quietly.
 *
 * API F-27. Seventeen list endpoints built their query with no LIMIT at all and
 * returned the whole table; `GET /api/tenant/sessions` returned every session
 * row the tenant had ever had.
 *
 * The obvious fix — apply the default limit of 50 — is wrong for several of
 * them, and dangerously so. `permission.listAll` EXISTS BECAUSE the paginated
 * version truncated: the grant matrix has more rows than the default seed
 * writes, so an editor loading through the paged endpoint could not see most
 * grants and overwrote them blind. Capping that endpoint would reintroduce
 * exactly the bug it was written to fix.
 *
 * So the rule here is: never silently truncate. Ask for `ceiling + 1` rows. If
 * that many come back, the caller's assumption that the set is small has been
 * violated, and the honest response is an error naming the endpoint — not a
 * prefix of the data presented as the whole. A loud 500 gets fixed; a silent
 * truncation on a permissions matrix corrupts the matrix.
 *
 * RETURNS `{ rows }`, deliberately — the same shape as `client.query`. Every
 * call site is a drop-in replacement for a `client.query` that was already
 * written as `const { rows } = await …`, and a helper that returned a bare
 * array would silently destructure to `undefined` at each one.
 *
 * @param {{query: Function}} client
 * @param {string} sql   without LIMIT — one is appended
 * @param {Array}  params
 * @param {{label: string, ceiling?: number}} opts
 * @returns {Promise<{rows: Array<object>}>}
 */
async function listComplete(client, sql, params = [], opts = {}) {
  const ceiling = opts.ceiling || 5000;
  const { rows } = await client.query(`${sql} LIMIT ${ceiling + 1}`, params);
  if (rows.length > ceiling) {
    throw new AppError(
      "RESULT_SET_TOO_LARGE",
      `${opts.label || "This list"} returned more than ${ceiling} rows. ` +
        "This endpoint is designed to return a complete set and cannot page; " +
        "returning a truncated one would silently corrupt whatever consumes it.",
      500,
    );
  }
  return { rows };
}

module.exports = {
  insertOne, updateOne, getById, page, TOTAL_COL, splitTotal, listComplete,
  ident, assertWritable, IDENT_RE,
};
