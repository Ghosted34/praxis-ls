/** Office expense repository (MOD-77). All office_expense SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "office_expense", data);
const get = (client, id) => getById(client, "office_expense", "office_expense_id", id);

async function update(client, id, fields) {
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "office_expense", "office_expense_id", id, fields, "*", null, { touch: "updated_at" });
}

async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.entity_id) { params.push(q.entity_id); wh.push("entity_id = $" + params.length); }
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (q.category) { params.push(q.category); wh.push("category = $" + params.length); }
  if (q.from) { params.push(q.from); wh.push("expense_date >= $" + params.length); }
  if (q.to) { params.push(q.to); wh.push("expense_date <= $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    "SELECT * FROM office_expense " + where + " ORDER BY expense_date DESC, created_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return rows;
}

/** Month-to-date + year-to-date totals for the page's KPI row, split by status. */
async function totals(client, q = {}) {
  const params = [];
  let entityFilter = "";
  if (q.entity_id) { params.push(q.entity_id); entityFilter = " AND entity_id = $" + params.length; }
  const { rows } = await client.query(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE date_trunc('month', expense_date) = date_trunc('month', CURRENT_DATE)), 0) AS mtd,
       COALESCE(SUM(amount) FILTER (WHERE date_trunc('year',  expense_date) = date_trunc('year',  CURRENT_DATE)), 0) AS ytd,
       COUNT(*) FILTER (WHERE status = 'DRAFT') AS draft_count
     FROM office_expense WHERE true` + entityFilter,
    params,
  );
  return { mtd: Number(rows[0].mtd), ytd: Number(rows[0].ytd), draft_count: Number(rows[0].draft_count) };
}

async function remove(client, id) {
  const { rowCount } = await client.query("DELETE FROM office_expense WHERE office_expense_id = $1", [id]);
  return rowCount > 0;
}

module.exports = { insert, get, update, list, totals, remove };
