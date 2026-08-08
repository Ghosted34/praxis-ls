/**
 * Treasury accounts (MOD-09, KB §7) — bank / cash / MoMo / petty accounts, one
 * per treasury_category, each mapped to an auto-minted class-5 GL leaf. Used
 * by invoicing, receipts, costing and disbursal.
 *
 * WHAT CHANGED IN THE 0519 REVAMP
 *
 *   – `category_id` is the new dimension. `kind` is kept, denormalised from
 *     `category.legacy_kind`, so pre-revamp consumers (finance/hub, entity-360,
 *     payment_receipt.method mapping) keep working.
 *
 *   – The CoA leaf is AUTO-MINTED on create. The service picks the parent
 *     from the category, asks the repo for existing children under it, hands
 *     them to rules.nextLeafCode, and inserts the leaf in the same tenant
 *     transaction as the treasury row. `label_fr` / `label_en` on the leaf
 *     track the treasury_account's `label`; the leaf survives deletion
 *     because journal history references it, but its is_active follows the
 *     treasury account's.
 *
 *   – Full banking / cash / MoMo identity is captured on create and update.
 *     Verification is a separate action (POST /:id/verify) that stamps
 *     verified_by + verified_at so "someone typed this in" and "we checked it
 *     against a bank letter" are distinguishable.
 *
 *   – "Set primary" is an atomic swap inside the entity + category.
 */
"use strict";

const repo = require("./treasury_account.repo");
const events = require("./treasury_account.events");
const rules = require("./treasury_account.rules");
const encryption = require("../../../services/encryption.service");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "treasury_account:" + id;
const gwRef = (p) => "payment_gateway:" + p;

/** Fields a caller can pass on the create body — everything else the service
 *  computes (kind from category.legacy_kind, coa_code from the allocator,
 *  is_verified false, etc.). */
const CREATE_FIELDS = [
  "label", "currency",
  "bank_name", "branch", "account_number", "iban", "swift_bic", "routing_code", "holder_name",
  "opening_balance", "opening_date", "statement_day",
  "custodian_user_id", "location", "float_limit",
  "momo_number", "momo_till", "momo_agent", "momo_network", "momo_fee_account",
];

/** Fields a caller can PATCH — no category, no coa_code, no verification stamps. */
const UPDATE_FIELDS = [
  "label", "currency",
  "bank_name", "branch", "account_number", "iban", "swift_bic", "routing_code", "holder_name",
  "opening_balance", "opening_date", "statement_day",
  "custodian_user_id", "location", "float_limit",
  "momo_number", "momo_till", "momo_agent", "momo_network", "momo_fee_account",
];

/**
 * Create a treasury account. Two writes in one transaction:
 *   1. mint the CoA leaf under `category.coa_parent_code`,
 *   2. insert the treasury_account row referencing that leaf.
 * The transaction guarantees neither the leaf nor the account can be left
 * orphaned by a mid-write crash.
 */
async function create(client, { entityId, categoryId, actor = {}, ...body }) {
  const category = await repo.getCategory(client, categoryId);
  rules.assertCreate({
    category,
    custodianUserId: body.custodian_user_id,
    coaCode: body.coa_code,   // must be undefined; assertCreate rejects otherwise
  });
  rules.assertMomoFeeAccount(body.momo_fee_account);

  await client.query("BEGIN");
  try {
    // Allocate the next 6-digit leaf under the category's parent.
    const existing = await repo.existingLeavesUnder(client, category.coa_parent_code);
    const leafCode = rules.nextLeafCode(category.coa_parent_code, existing);
    await repo.insertLeafCoa(client, {
      code: leafCode,
      parentCode: category.coa_parent_code,
      label: body.label,
      entityId,
    });

    // Build the row from the allow-list; drop anything else the body carried.
    const data = { entity_id: entityId, category_id: categoryId, kind: category.legacy_kind, coa_code: leafCode };
    for (const k of CREATE_FIELDS) if (body[k] !== undefined) data[k] = body[k];
    // `created_by` FKs to app_user(user_id), which lives in the LIVE schema.
    // In SANDBOX a raw actor.user_id 23503-fails; resolveActorId returns null
    // instead so the row lands (attribution is lost but the operation stands).
    // DATA 2.4 — enforced by scripts/check-actor-fk-guard.js.
    data.created_by = await resolveActorId(client, actor.user_id);

    const row = await repo.insert(client, data);
    await emitEvent(client, {
      eventTypeKey: events.CREATED, moduleKey: events.MODULE,
      entityRef: ref(row.treasury_account_id), actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE,
      entityRef: ref(row.treasury_account_id), after: row,
    });
    await client.query("COMMIT");
    // Return the joined shape so the client can render immediately.
    return repo.getWithCategory(client, row.treasury_account_id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/**
 * Patch an account. category_id and coa_code are ignored (managed elsewhere);
 * kind stays in sync with category so nothing needs to be done there. Renaming
 * the account renames its CoA leaf too, so the trial balance stays legible.
 */
async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Treasury account not found", 404);

  const fields = {};
  for (const k of UPDATE_FIELDS) if (patch[k] !== undefined) fields[k] = patch[k];
  rules.assertMomoFeeAccount(fields.momo_fee_account);

  // If the category requires a custodian, updating cannot clear it.
  if (patch.custodian_user_id === null && before.category_id) {
    const cat = await repo.getCategory(client, before.category_id);
    if (cat && cat.requires_custodian) {
      throw new AppError(
        "NO_CUSTODIAN",
        "cannot clear the custodian on a " + cat.code + " account",
        422,
      );
    }
  }

  // `updated_by` FKs to app_user(user_id) — same LIVE-vs-SANDBOX story as
  // `created_by` in create(). DATA 2.4.
  fields.updated_by = await resolveActorId(client, actor.user_id);

  const row = await repo.update(client, id, fields);
  if (patch.label && patch.label !== before.label && before.coa_code) {
    // Keep the CoA leaf's label in sync with the treasury account's.
    await repo.renameLeaf(client, before.coa_code, patch.label);
  }
  await audit(client, {
    actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE,
    entityRef: ref(id), before, after: row,
  });
  return repo.getWithCategory(client, id);
}

async function setActive(client, { id, active, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Treasury account not found", 404);
  await client.query("BEGIN");
  try {
    const row = await repo.update(client, id, { is_active: active === true });
    // Follow-through on the CoA leaf so nobody can post to a deactivated
    // account by hand-writing a journal.
    if (before.coa_code) await repo.setLeafActive(client, before.coa_code, active === true);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: active ? "treasury_account.activated" : "treasury_account.deactivated",
      moduleKey: events.MODULE, entityRef: ref(id), after: row,
    });
    await client.query("COMMIT");
    return repo.getWithCategory(client, id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/**
 * POST /:id/primary — atomic swap. Clears the previous primary in the same
 * (entity_id, category_id) then flips this one on. No-op if the row is
 * already primary.
 */
async function setPrimary(client, { id, actor = {} }) {
  const row = await repo.get(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Treasury account not found", 404);
  if (!row.category_id) throw new AppError("NO_CATEGORY", "cannot set primary on a row without a category", 422);
  await client.query("BEGIN");
  try {
    await repo.clearPrimaryInCategory(client, {
      entityId: row.entity_id, categoryId: row.category_id, exceptId: id,
    });
    const next = await repo.update(client, id, { is_primary: true });
    await audit(client, {
      actorUserId: actor.user_id || null, action: "treasury_account.primary_set",
      moduleKey: events.MODULE, entityRef: ref(id), after: next,
    });
    await client.query("COMMIT");
    return repo.getWithCategory(client, id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/**
 * POST /:id/verify — stamps verified_by + verified_at. The two exist as a
 * pair (constraint chk_treasury_verified_stamped) so an account is either
 * cleanly verified or cleanly unverified.
 */
async function verify(client, { id, actor = {} }) {
  const row = await repo.get(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Treasury account not found", 404);
  // `verified_by` FKs to app_user(user_id) — LIVE only. Resolve through the
  // sandbox guard rather than storing a raw actor id; DATA 2.4.
  const verifiedBy = await resolveActorId(client, actor.user_id);
  const next = await repo.update(client, id, {
    is_verified: true,
    verified_by: verifiedBy,
    verified_at: new Date(),
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: "treasury_account.verified",
    moduleKey: events.MODULE, entityRef: ref(id), after: next,
  });
  return repo.getWithCategory(client, id);
}

async function unverify(client, { id, actor = {} }) {
  const row = await repo.get(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Treasury account not found", 404);
  const next = await repo.update(client, id, {
    is_verified: false, verified_by: null, verified_at: null,
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: "treasury_account.unverified",
    moduleKey: events.MODULE, entityRef: ref(id), after: next,
  });
  return repo.getWithCategory(client, id);
}

const get  = (client, id) => repo.getWithCategory(client, id);
const list = (client, q)  => repo.list(client, q);

// ── Payment gateways (2.3) — unchanged from pre-revamp ──
const safeGateway = (row) => row && ({ provider: row.provider, active: row.active, role: row.role, has_credentials: row.has_credentials === true, updated_at: row.updated_at });
const listGateways = (client) => repo.listGateways(client);
async function getGateway(client, provider) {
  const row = await repo.getGatewayRaw(client, provider);
  if (!row) throw new AppError("NOT_FOUND", "Payment gateway not found", 404);
  return { provider: row.provider, active: row.active, role: row.role, has_credentials: row.credentials_enc !== null, updated_at: row.updated_at };
}
async function upsertGateway(client, { provider, active, role, credentials, actor = {} }) {
  const existing = await repo.getGatewayRaw(client, provider);
  const credentials_enc = credentials !== undefined && credentials !== null && credentials !== ""
    ? encryption.encrypt(typeof credentials === "string" ? credentials : JSON.stringify(credentials))
    : null;
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
  create, update, setActive, setPrimary, verify, unverify, get, list,
  listGateways, getGateway, upsertGateway, setGatewayActive, setGatewayRole, deleteGateway,
};
