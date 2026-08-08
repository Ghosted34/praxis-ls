/**
 * treasury_category service (MOD-09) — the user-editable registry of
 * treasury account types. See migrations/tenant/0520_treasury_master_rich.sql.
 */
"use strict";
const repo = require("./treasury_category.repo");
const events = require("./treasury_category.events");
const rules = require("./treasury_category.rules");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "treasury_category:" + id;

async function create(client, {
  code, label, legacyKind, coaParentCode,
  requiresCustodian = false, isBankIdentity = false, isMomoIdentity = false,
  actor = {},
}) {
  const normalised = String(code || "").trim().toUpperCase();
  rules.assertCode(normalised);
  rules.assertLegacyKind(legacyKind);
  const parent = await repo.getCoa(client, coaParentCode);
  rules.assertCoaParent(parent);

  const existing = await repo.getByCode(client, normalised);
  if (existing) throw new AppError("DUPLICATE_CODE", "a category with code " + normalised + " already exists", 409);

  await client.query("BEGIN");
  try {
    // `created_by` FKs to app_user(user_id) which lives in LIVE. In SANDBOX
    // a raw actor.user_id 23503-fails; resolveActorId returns null so the
    // row lands (attribution is lost but the operation stands). DATA 2.4
    // — enforced by scripts/check-actor-fk-guard.js.
    const createdBy = await resolveActorId(client, actor.user_id);
    const row = await repo.insert(client, {
      code: normalised,
      label: String(label || normalised).trim(),
      legacy_kind: legacyKind,
      coa_parent_code: coaParentCode,
      requires_custodian: requiresCustodian === true,
      is_bank_identity:   isBankIdentity === true,
      is_momo_identity:   isMomoIdentity === true,
      is_system: false,
      is_active: true,
      created_by: createdBy,
    });
    await emitEvent(client, {
      eventTypeKey: events.CREATED, moduleKey: events.MODULE,
      entityRef: ref(row.treasury_category_id), actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE,
      entityRef: ref(row.treasury_category_id), after: row,
    });
    await client.query("COMMIT");
    return row;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Treasury category not found", 404);
  const fields = {};
  // System rows: label and capability flags can be tuned; code and legacy_kind
  // are frozen (renaming BANK's code would break every screen that reads it).
  if (patch.label !== undefined) fields.label = String(patch.label).trim();
  if (patch.requires_custodian !== undefined) fields.requires_custodian = patch.requires_custodian === true;
  if (patch.is_bank_identity   !== undefined) fields.is_bank_identity   = patch.is_bank_identity === true;
  if (patch.is_momo_identity   !== undefined) fields.is_momo_identity   = patch.is_momo_identity === true;
  if (!before.is_system && patch.code !== undefined) {
    const c = String(patch.code).trim().toUpperCase();
    rules.assertCode(c);
    fields.code = c;
  }
  if (!before.is_system && patch.coa_parent_code !== undefined) {
    const parent = await repo.getCoa(client, patch.coa_parent_code);
    rules.assertCoaParent(parent);
    fields.coa_parent_code = patch.coa_parent_code;
  }
  const row = await repo.update(client, id, fields);
  await audit(client, {
    actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE,
    entityRef: ref(id), before, after: row,
  });
  return row;
}

async function setActive(client, { id, active, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Treasury category not found", 404);
  const row = await repo.update(client, id, { is_active: active === true });
  await audit(client, {
    actorUserId: actor.user_id || null,
    action: active ? events.ACTIVATED : events.DEACTIVATED,
    moduleKey: events.MODULE, entityRef: ref(id), after: row,
  });
  return row;
}

async function remove(client, { id, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Treasury category not found", 404);
  if (before.is_system) throw new AppError("SYSTEM_CATEGORY", "system categories cannot be deleted", 422);
  const usage = await repo.countUsage(client, id);
  if (usage > 0) throw new AppError("IN_USE", "category is used by " + usage + " treasury account(s); deactivate instead", 409);
  const ok = await repo.del(client, id);
  if (!ok) throw new AppError("NOT_FOUND", "Treasury category not found", 404);
  await audit(client, {
    actorUserId: actor.user_id || null, action: "treasury_category.deleted",
    moduleKey: events.MODULE, entityRef: ref(id),
  });
  return { deleted: true };
}

const get  = (client, id) => repo.get(client, id);
const list = (client, q)  => repo.list(client, q);

module.exports = { create, update, setActive, remove, get, list };
