/** Chart of Accounts repository (MOD-06). All chart_of_accounts SQL lives here. */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "chart_of_accounts", data);
const get = (client, code) => getById(client, "chart_of_accounts", "code", code);

async function update(client, code, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return get(client, code);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query("UPDATE chart_of_accounts SET " + set + " WHERE code = $1 RETURNING *", [code, ...keys.map((k) => fields[k])]);
  return rows[0] || null;
}

async function children(client, code) {
  const { rows } = await client.query("SELECT code FROM chart_of_accounts WHERE parent_code = $1", [code]);
  return rows;
}

/** Is the account referenced anywhere (journal_line, posting_rule, or has children)? */
async function referencedBy(client, code) {
  const jl = await client.query("SELECT 1 FROM journal_line WHERE account_code = $1 LIMIT 1", [code]);
  if (jl.rows.length) return "journal_line";
  const pr = await client.query("SELECT 1 FROM posting_rule WHERE debit_account = $1 OR credit_account = $1 LIMIT 1", [code]);
  if (pr.rows.length) return "posting_rule";
  const ch = await client.query("SELECT 1 FROM chart_of_accounts WHERE parent_code = $1 LIMIT 1", [code]);
  if (ch.rows.length) return "child_accounts";
  return null;
}

async function remove(client, code) { await client.query("DELETE FROM chart_of_accounts WHERE code = $1", [code]); }

async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset]; const wh = [];
  if (q.class) { params.push(Number(q.class)); wh.push("class = $" + params.length); }
  if (q.parent_code) { params.push(q.parent_code); wh.push("parent_code = $" + params.length); }
  if (q.postable !== undefined) { params.push(q.postable === "true" || q.postable === true); wh.push("is_postable = $" + params.length); }
  if (q.q) { params.push("%" + q.q + "%"); wh.push("(code ILIKE $" + params.length + " OR label_fr ILIKE $" + params.length + ")"); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM chart_of_accounts " + where + " ORDER BY code LIMIT $1 OFFSET $2", params);
  return rows;
}

module.exports = { insert, get, update, children, referencedBy, remove, list };
