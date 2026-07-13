/**
 * Treasury accounts (MOD-09, KB §7) — bank / cash / MoMo accounts, each mapped to
 * a class-5 GL account. Used by invoicing, receipts, costing and disbursal.
 * All SQL is in the repo; validation is in the rules.
 */
"use strict";

const repo = require("./treasury_account.repo");
const events = require("./treasury_account.events");
const { assertCashAccount, assertMomo } = require("./treasury_account.rules");
const encryption = require("../../../services/encryption.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "treasury_account:" + id;
const gwRef = (p) => "payment_gateway:" + p;

async function create(client, { entityId, kind, label, coaCode, momoNetwork = null, momoFeeAccount = null, currency = "XAF", actor = {} }) {
  assertCashAccount(coaCode);
  assertMomo({ kind, momoNetwork, momoFeeAccount });
  await client.query("BEGIN");
  try {
    const row = await repo.insert(client, { entity_id: entityId, kind, label, coa_code: coaCode, momo_network: momoNetwork, momo_fee_account: momoFeeAccount, currency });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.treasury_account_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.treasury_account_id), after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Treasury account not found", 404);
  const fields = {};
  for (const k of ["label", "currency", "momo_network", "momo_fee_account"]) if (patch[k] !== undefined) fields[k] = patch[k];
  if (patch.coa_code !== undefined) { assertCashAccount(patch.coa_code); fields.coa_code = patch.coa_code; }
  assertMomo({ kind: before.kind, momoNetwork: fields.momo_network ?? before.momo_network, momoFeeAccount: fields.momo_fee_account ?? before.momo_fee_account });
  const row = await repo.update(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

async function setActive(client, { id, active, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Treasury account not found", 404);
  const row = await repo.update(client, id, { is_active: active === true });
  await audit(client, { actorUserId: actor.user_id || null, action: active ? "treasury_account.activated" : "treasury_account.deactivated", moduleKey: events.MODULE, entityRef: ref(id), after: row });
  return row;
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);

// ── Payment gateways (2.3) — credentials write-only; API never returns them ──
const safeGateway = (row) => row && ({ provider: row.provider, active: row.active, role: row.role, has_credentials: row.has_credentials === true, updated_at: row.updated_at });

const listGateways = (client) => repo.listGateways(client);
async function getGateway(client, provider) {
  const row = await repo.getGatewayRaw(client, provider);
  if (!row) throw new AppError("NOT_FOUND", "Payment gateway not found", 404);
  return { provider: row.provider, active: row.active, role: row.role, has_credentials: row.credentials_enc != null, updated_at: row.updated_at };
}
async function upsertGateway(client, { provider, active, role, credentials, actor = {} }) {
  const existing = await repo.getGatewayRaw(client, provider);
  const credentials_enc = credentials !== undefined && credentials !== null && credentials !== ""
    ? encryption.encrypt(typeof credentials === "string" ? credentials : JSON.stringify(credentials))
    : null; // null → keep any existing ciphertext
  const nextActive = active !== undefined ? active === true : (existing ? existing.active : false);
  const nextRole = role !== undefined ? role : (existing ? existing.role : null);
  const row = await repo.upsertGateway(client, { provider, active: nextActive, role: nextRole, credentials_enc, updatedBy: actor.user_id || null });
  await emitEvent(client, { eventTypeKey: events.GATEWAY_SET, moduleKey: events.MODULE, entityRef: gwRef(provider), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.GATEWAY_SET, moduleKey: events.MODULE, entityRef: gwRef(provider), after: safeGateway(row) });
  return safeGateway(row);
}
async function setGatewayActive(client, { provider, active, actor = {} }) {
  const row = await repo.setGatewayActive(client, provider, active === true);
  if (!row) throw new AppError("NOT_FOUND", "Payment gateway not found", 404);
  await audit(client, { actorUserId: actor.user_id || null, action: active ? "payment_gateway.activated" : "payment_gateway.deactivated", moduleKey: events.MODULE, entityRef: gwRef(provider), after: safeGateway(row) });
  return safeGateway(row);
}
async function setGatewayRole(client, { provider, role, actor = {} }) {
  const row = await repo.setGatewayRole(client, provider, role);
  if (!row) throw new AppError("NOT_FOUND", "Payment gateway not found", 404);
  await audit(client, { actorUserId: actor.user_id || null, action: "payment_gateway.role_set", moduleKey: events.MODULE, entityRef: gwRef(provider), after: safeGateway(row) });
  return safeGateway(row);
}
async function deleteGateway(client, { provider, actor = {} }) {
  const ok = await repo.deleteGateway(client, provider);
  if (!ok) throw new AppError("NOT_FOUND", "Payment gateway not found", 404);
  await audit(client, { actorUserId: actor.user_id || null, action: "payment_gateway.deleted", moduleKey: events.MODULE, entityRef: gwRef(provider) });
  return { deleted: true };
}

module.exports = {
  create, update, setActive, get, list,
  listGateways, getGateway, upsertGateway, setGatewayActive, setGatewayRole, deleteGateway,
};
