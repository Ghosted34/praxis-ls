"use strict";
const { makeRepo } = require("../../../shared/crud/resource");

const crud = makeRepo({ table: "tax_declaration", pk: "tax_declaration_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });

// Upsert on the natural key (entity_id, kind, period_code) — re-filing a period
// recomputes the same row rather than duplicating it.
async function upsertDeclaration(client, d) {
  const { rows } = await client.query(
    "INSERT INTO tax_declaration (entity_id, kind, period_code, computed_dataset, amount_due, status, due_on) " +
      "VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7) " +
      "ON CONFLICT (entity_id, kind, period_code) DO UPDATE SET " +
      "computed_dataset = EXCLUDED.computed_dataset, amount_due = EXCLUDED.amount_due, status = EXCLUDED.status, " +
      "due_on = COALESCE(EXCLUDED.due_on, tax_declaration.due_on), updated_at = now() RETURNING *",
    [d.entity_id || null, d.kind, d.period_code, JSON.stringify(d.computed_dataset || {}), d.amount_due, d.status || "COMPUTED", d.due_on || null]);
  return rows[0];
}
async function getDeclaration(client, id) {
  const { rows } = await client.query("SELECT * FROM tax_declaration WHERE tax_declaration_id = $1", [id]);
  return rows[0] || null;
}
async function listDeclarations(client, q = {}) {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
  const params = [limit, offset]; const wh = [];
  if (q.entity_id) { params.push(q.entity_id); wh.push("entity_id = $" + params.length); }
  if (q.kind) { params.push(q.kind); wh.push("kind = $" + params.length); }
  if (q.status) { params.push(q.status); wh.push("status = $" + params.length); }
  if (q.period_code) { params.push(q.period_code); wh.push("period_code = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM tax_declaration " + where + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}
async function setStatus(client, id, patch) {
  const params = [id, patch.status]; const sets = ["status = $2"];
  if (patch.filed_on !== undefined) { params.push(patch.filed_on); sets.push("filed_on = $" + params.length); }
  if (patch.filed_ref !== undefined) { params.push(patch.filed_ref); sets.push("filed_ref = $" + params.length); }
  const { rows } = await client.query(
    "UPDATE tax_declaration SET " + sets.join(", ") + ", updated_at = now() WHERE tax_declaration_id = $1 RETURNING *", params);
  return rows[0] || null;
}

module.exports = { ...crud, upsertDeclaration, getDeclaration, listDeclarations, setStatus };
