/** Treasury-account repository (MOD-09). All SQL lives here. */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "treasury_account", data);
const get = (client, id) => getById(client, "treasury_account", "treasury_account_id", id);

async function update(client, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return get(client, id);
  const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ");
  const { rows } = await client.query("UPDATE treasury_account SET " + set + " WHERE treasury_account_id = $1 RETURNING *", [id, ...keys.map((k) => fields[k])]);
  return rows[0] || null;
}
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.entity_id) { params.push(q.entity_id); wh.push("entity_id = $" + params.length); }
  if (q.kind) { params.push(q.kind); wh.push("kind = $" + params.length); }
  if (q.is_active !== undefined) { params.push(q.is_active === "true" || q.is_active === true); wh.push("is_active = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query("SELECT * FROM treasury_account " + where + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}
// ── Payment gateways (2.3) — credentials_enc never selected into API shapes ──
const GW_COLS = "provider, active, role, (credentials_enc IS NOT NULL) AS has_credentials, updated_at";
async function listGateways(client) {
  const { rows } = await client.query("SELECT " + GW_COLS + " FROM payment_gateway ORDER BY provider");
  return rows;
}
async function getGatewayRaw(client, provider) {
  const { rows } = await client.query("SELECT * FROM payment_gateway WHERE provider = $1", [provider]);
  return rows[0] || null;
}
async function upsertGateway(client, { provider, active, role, credentials_enc, updatedBy }) {
  // credentials_enc = null keeps the existing ciphertext (COALESCE), so role/active
  // can be changed without re-supplying the secret.
  const { rows } = await client.query(
    "INSERT INTO payment_gateway (provider, active, role, credentials_enc, updated_by) VALUES ($1,$2,$3,$4,$5) " +
      "ON CONFLICT (provider) DO UPDATE SET active = EXCLUDED.active, role = EXCLUDED.role, " +
      "credentials_enc = COALESCE(EXCLUDED.credentials_enc, payment_gateway.credentials_enc), " +
      "updated_by = EXCLUDED.updated_by, updated_at = now() RETURNING " + GW_COLS,
    [provider, active, role, credentials_enc, updatedBy || null]);
  return rows[0];
}
async function setGatewayActive(client, provider, active) {
  const { rows } = await client.query(
    "UPDATE payment_gateway SET active = $2, updated_at = now() WHERE provider = $1 RETURNING " + GW_COLS,
    [provider, active]);
  return rows[0] || null;
}
async function setGatewayRole(client, provider, role) {
  const { rows } = await client.query(
    "UPDATE payment_gateway SET role = $2, updated_at = now() WHERE provider = $1 RETURNING " + GW_COLS,
    [provider, role]);
  return rows[0] || null;
}
async function deleteGateway(client, provider) {
  const { rowCount } = await client.query("DELETE FROM payment_gateway WHERE provider = $1", [provider]);
  return rowCount > 0;
}

module.exports = {
  insert, get, update, list,
  listGateways, getGatewayRaw, upsertGateway, setGatewayActive, setGatewayRole, deleteGateway,
};
