/**
 * Treasury-account repository (MOD-09). All SQL lives here.
 *
 * The 0519 revamp added category_id + a wide set of banking / cash /
 * MoMo identity columns. Writes go through the `writable` allow-list to
 * prevent mass assignment via `insertOne`/`updateOne` — the treasury table
 * carries verification stamps and CoA leaves; a body that could overwrite
 * either would be a straight-line path to fraud.
 */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const WRITABLE = [
  // Identity + accounting
  "entity_id", "kind", "category_id", "label", "coa_code", "currency",
  "momo_network", "momo_fee_account",
  // Banking identity
  "bank_name", "branch", "account_number", "iban", "swift_bic", "routing_code", "holder_name",
  // Opening + statement
  "opening_balance", "opening_date", "statement_day",
  // Flags + verification
  "is_primary", "is_active", "is_verified", "verified_by", "verified_at",
  // Cash / petty
  "custodian_user_id", "location", "float_limit",
  // MoMo identity
  "momo_number", "momo_till", "momo_agent",
  // Audit surface
  "created_by", "updated_by",
];

const insert = (client, data) => insertOne(client, "treasury_account", data, "*", WRITABLE);
const get    = (client, id)   => getById(client, "treasury_account", "treasury_account_id", id);

async function update(client, id, fields) {
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "treasury_account", "treasury_account_id", id, fields, "*", WRITABLE);
}

/**
 * List with the category joined so the UI can render "Bank / MTN Mobile Money"
 * without a second round-trip. Filters: entity_id, kind (legacy),
 * category_id, is_active, custodian_user_id.
 */
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.entity_id) { params.push(q.entity_id); wh.push("t.entity_id = $" + params.length); }
  if (q.kind)      { params.push(q.kind);      wh.push("t.kind = $" + params.length); }
  if (q.category_id) { params.push(q.category_id); wh.push("t.category_id = $" + params.length); }
  if (q.is_active !== undefined) {
    params.push(q.is_active === "true" || q.is_active === true);
    wh.push("t.is_active = $" + params.length);
  }
  if (q.custodian_user_id) { params.push(q.custodian_user_id); wh.push("t.custodian_user_id = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    "SELECT t.*, c.code AS category_code, c.label AS category_label, " +
    "       c.requires_custodian AS category_requires_custodian, " +
    "       c.is_bank_identity   AS category_is_bank_identity, " +
    "       c.is_momo_identity   AS category_is_momo_identity, " +
    "       c.coa_parent_code    AS category_coa_parent_code " +
    "  FROM treasury_account t " +
    "  LEFT JOIN treasury_category c ON c.treasury_category_id = t.category_id " +
    "  " + where +
    " ORDER BY t.is_primary DESC, t.created_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return rows;
}

/** Fetch the account joined with its category — used by the create/update flow
 *  and by treasury-360 for the header. */
async function getWithCategory(client, id) {
  const { rows } = await client.query(
    "SELECT t.*, c.code AS category_code, c.label AS category_label, " +
    "       c.requires_custodian AS category_requires_custodian, " +
    "       c.is_bank_identity   AS category_is_bank_identity, " +
    "       c.is_momo_identity   AS category_is_momo_identity, " +
    "       c.coa_parent_code    AS category_coa_parent_code " +
    "  FROM treasury_account t " +
    "  LEFT JOIN treasury_category c ON c.treasury_category_id = t.category_id " +
    " WHERE t.treasury_account_id = $1",
    [id],
  );
  return rows[0] || null;
}

/**
 * Load a treasury_category by id. The service uses this to know the CoA
 * parent and the capability flags.
 */
async function getCategory(client, id) {
  const { rows } = await client.query(
    "SELECT * FROM treasury_category WHERE treasury_category_id = $1",
    [id],
  );
  return rows[0] || null;
}

/**
 * List the existing CoA leaf codes under a parent. Fed to rules.nextLeafCode
 * to pick the next 6-digit child.
 */
async function existingLeavesUnder(client, parentCode) {
  const { rows } = await client.query(
    "SELECT code FROM chart_of_accounts WHERE parent_code = $1",
    [parentCode],
  );
  return rows.map((r) => r.code);
}

/**
 * Insert a treasury-owned CoA leaf. is_system=false marks it as tenant-owned
 * (i.e. not the seeded statutory set), is_postable=true so entries can post
 * to it, and it inherits `entity_id` so the trial balance can be filtered by
 * corporate entity.
 */
async function insertLeafCoa(client, { code, parentCode, label, entityId }) {
  const { rows } = await client.query(
    "INSERT INTO chart_of_accounts " +
    "  (code, parent_code, label_fr, label_en, class, normal_balance, " +
    "   is_postable, requires_analytic, entity_id, is_system, is_active) " +
    " VALUES ($1, $2, $3, $3, 5, 'D', true, false, $4, false, true) RETURNING *",
    [code, parentCode, label || code, entityId || null],
  );
  return rows[0];
}

/**
 * Deactivate a CoA leaf. Called when a treasury account is deactivated —
 * history references the code and must survive, so we never delete the row.
 */
async function setLeafActive(client, code, active) {
  const { rows } = await client.query(
    "UPDATE chart_of_accounts SET is_active = $2 WHERE code = $1 RETURNING *",
    [code, active === true],
  );
  return rows[0] || null;
}

/**
 * Rename a CoA leaf's label to track the treasury_account's `label`. Called
 * from update(); the leaf's public name should follow the treasurer's.
 */
async function renameLeaf(client, code, label) {
  const { rows } = await client.query(
    "UPDATE chart_of_accounts SET label_fr = $2, label_en = $2 WHERE code = $1 RETURNING *",
    [code, label],
  );
  return rows[0] || null;
}

/**
 * "Clear primary" — inside a transaction the service opens, to make POST
 * /:id/primary an atomic swap: the previous primary in the same
 * (entity_id, category_id) goes false, then the target goes true.
 */
async function clearPrimaryInCategory(client, { entityId, categoryId, exceptId }) {
  await client.query(
    "UPDATE treasury_account SET is_primary = false " +
    "  WHERE entity_id = $1 AND category_id = $2 AND treasury_account_id <> $3 AND is_primary = true",
    [entityId, categoryId, exceptId],
  );
}

// ── Payment gateways (2.3) — unchanged from pre-revamp, credentials write-only ──
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
  insert, get, update, list, getWithCategory,
  getCategory, existingLeavesUnder, insertLeafCoa, setLeafActive, renameLeaf,
  clearPrimaryInCategory,
  listGateways, getGatewayRaw, upsertGateway, setGatewayActive, setGatewayRole, deleteGateway,
};
