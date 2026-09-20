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
 *   – "Set primary" is an atomic swap inside the entity (PR-10 / A1: one
 *     primary per ENTITY, not per (entity, category) — the letterhead payment
 *     block and the entity Banking tab read it, and they need one answer).
 */
"use strict";

const repo = require("./treasury_account.repo");
const events = require("./treasury_account.events");
const rules = require("./treasury_account.rules");
const encryption = require("../../../services/encryption.service");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

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
    momoNetwork: body.momo_network,
  });
  rules.assertMomoFeeAccount(body.momo_fee_account);

  await client.query("BEGIN");
  try {
    // Assert and lock the parent CoA row FOR UPDATE to prevent allocation race conditions (#31, #32)
    const parentCoa = await repo.lockParentCoa(client, category.coa_parent_code);
    rules.assertCoaParent(parentCoa);

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

const SENSITIVE_FIELDS = [
  "bank_name", "branch", "account_number", "iban", "swift_bic", "routing_code", "holder_name",
  "opening_balance", "opening_date", "statement_day",
  "custodian_user_id", "location", "float_limit",
  "momo_number", "momo_till", "momo_agent", "momo_network", "momo_fee_account",
];

/**
 * Patch an account. category_id and coa_code are ignored (managed elsewhere);
 * kind stays in sync with category so nothing needs to be done there. Renaming
 * the account renames its CoA leaf too, so the trial balance stays legible.
 *
 * `is_primary` is NOT patchable (it is not in UPDATE_FIELDS): the flag changes
 * only through POST /:id/primary or a deactivation-with-replacement, both of
 * which clear the other primaries FOR THE ENTITY in one transaction
 * (PR-10 / A1) — the generic write path cannot reintroduce the six-primaries
 * defect the dedicated endpoints just fixed.
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

  // Audit #13: Controlled opening balance correction
  if (
    patch.opening_balance !== undefined &&
    before.opening_balance !== null &&
    Number(patch.opening_balance) !== Number(before.opening_balance)
  ) {
    let hasJournals = false;
    if (before.coa_code) {
      const { rows } = await client.query(
        "SELECT 1 FROM journal_line WHERE account_code = $1 LIMIT 1",
        [before.coa_code]
      );
      hasJournals = rows.length > 0;
    }
    rules.assertOpeningBalanceCorrection({
      hasJournals,
      reason: patch.opening_balance_reason,
    });
  }

  // Audit #8: Invalidate verification after sensitive account edits
  let sensitiveChanged = false;
  if (before.is_verified) {
    for (const k of SENSITIVE_FIELDS) {
      if (patch[k] !== undefined && String(patch[k] ?? "") !== String(before[k] ?? "")) {
        sensitiveChanged = true;
        break;
      }
    }
    if (sensitiveChanged) {
      fields.is_verified = false;
      fields.verified_by = null;
      fields.verified_at = null;
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

  if (sensitiveChanged) {
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: "treasury_account.verification_invalidated",
      moduleKey: events.MODULE,
      entityRef: ref(id),
      before: { is_verified: true, verified_by: before.verified_by, verified_at: before.verified_at },
      after: { is_verified: false, verified_by: null, verified_at: null },
    });
  }

  return repo.getWithCategory(client, id);
}

async function setActive(client, { id, active, forceClearPrimary = false, replacementAccountId = null, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Treasury account not found", 404);
  await client.query("BEGIN");
  try {
    // Audit #12: Prevent deactivation of primary account without replacement or explicit confirmation
    if (active === false && before.is_primary === true) {
      if (replacementAccountId) {
        const rep = await repo.get(client, replacementAccountId);
        if (!rep || !rep.is_active || rep.category_id !== before.category_id) {
          throw new AppError("BAD_REPLACEMENT", "Replacement account must be an active account in the same category", 422);
        }
        // PR-10 / A1: entity-wide clearing — the replacement becomes THE
        // primary, so no other account anywhere in the entity keeps a stale
        // flag beside it.
        await repo.clearPrimaryForEntity(client, {
          entityId: rep.entity_id, exceptId: replacementAccountId,
        });
        await repo.update(client, replacementAccountId, { is_primary: true });
      } else if (forceClearPrimary === true) {
        await repo.update(client, id, { is_primary: false });
      } else {
        throw new AppError(
          "PRIMARY_DEACTIVATION_BLOCKED",
          "Cannot deactivate primary account without replacement or explicit confirmation",
          422,
        );
      }
    }

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
    // PR-10 / A1: a deliberate clear (forceClearPrimary) may leave the entity
    // with no primary — legal, but say so rather than let the letterhead's
    // "No primary account selected" state arrive as a surprise.
    if (active === false && before.is_primary === true && forceClearPrimary === true) {
      await warnIfNoPrimary(client, before.entity_id);
    }
    return repo.getWithCategory(client, id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/**
 * PR-10 / A1 — warn, never fail, when a change leaves an entity with no
 * primary account at all.
 *
 * "No primary" is a legal state (a brand-new tenant, a deliberate clear), but
 * it is the state the entity's letterhead payment block and Banking & treasury
 * tab render as an explicit "No primary account selected" hint — and the state
 * the primary-account resolver reports as `unset`. A WARNING makes the
 * operator's next save the fix, without blocking a legitimate clear the way
 * the deactivation guard (Audit #12) blocks a deliberate removal.
 */
async function warnIfNoPrimary(client, entityId) {
  try {
    const n = await repo.countPrimaries(client, entityId);
    if (n === 0) {
      logger.warn(
        { entity_id: entityId },
        "treasury_account: entity has no primary account — the letterhead payment block and the entity Banking tab will show their 'No primary account selected' state",
      );
    }
  } catch (err) {
    /* @silent:metrics — the warning is advisory; a broken count must not fail a committed change */
    logger.debug({ err, entity_id: entityId }, "treasury_account: primary-count check skipped");
  }
}

/**
 * POST /:id/primary — atomic swap. Clears every OTHER primary FOR THE ENTITY
 * (PR-10 / A1 — this used to clear only the same (entity_id, category_id), so
 * an entity could accumulate one "primary" per category and the letterhead
 * could not say which account an invoice should be paid into), then flips this
 * one on. No-op if the row is already primary.
 */
async function setPrimary(client, { id, actor = {} }) {
  const row = await repo.get(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Treasury account not found", 404);
  if (!row.category_id) throw new AppError("NO_CATEGORY", "cannot set primary on a row without a category", 422);
  await client.query("BEGIN");
  try {
    await repo.clearPrimaryForEntity(client, {
      entityId: row.entity_id, exceptId: id,
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
  const row = await repo.getWithCategory(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Treasury account not found", 404);

  // Audit #7: Enforce complete banking/MoMo/petty identity before verifying
  rules.assertVerificationPrerequisites(row);

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

/** Reverse a validated journal entry on this treasury account (PR-06, Audit #5). */
async function reverseEntry(client, { accountId, entryId, reason, actor = {} }) {
  const account = await repo.get(client, accountId);
  if (!account) throw new AppError("NOT_FOUND", "Treasury account not found", 404);

  const { rows } = await client.query(
    "SELECT jl.line_id, je.status FROM journal_line jl JOIN journal_entry je ON je.entry_id = jl.entry_id WHERE jl.entry_id = $1 AND jl.account_code = $2 LIMIT 1",
    [entryId, account.coa_code],
  );
  if (!rows.length) {
    throw new AppError("ENTRY_NOT_ON_ACCOUNT", "Journal entry does not belong to this treasury account", 400);
  }

  const journalService = require("../../finance/journal_entry/journal_entry.service");
  return journalService.reverse(client, { entryId, reason, actor });
}

// ── Documents (PR-03, Audit #1, #2) ──
async function listDocuments(client, accountId) {
  return repo.listDocuments(client, accountId);
}

async function addDocument(client, { accountId, actor = {}, ...body }) {
  const acc = await repo.get(client, accountId);
  if (!acc) throw new AppError("NOT_FOUND", "Treasury account not found", 404);
  const createdBy = await resolveActorId(client, actor.user_id);
  const row = await repo.insertDocument(client, {
    treasury_account_id: accountId,
    created_by: createdBy,
    ...body,
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: "treasury_account.document_added",
    moduleKey: events.MODULE, entityRef: ref(accountId), after: row,
  });
  return row;
}

async function removeDocument(client, { accountId, documentId, actor = {} }) {
  const doc = await repo.getDocument(client, documentId);
  if (!doc || doc.treasury_account_id !== accountId) {
    throw new AppError("NOT_FOUND", "Treasury document not found", 404);
  }
  await repo.deleteDocument(client, documentId);
  await audit(client, {
    actorUserId: actor.user_id || null, action: "treasury_account.document_removed",
    moduleKey: events.MODULE, entityRef: ref(accountId), before: doc,
  });
  return { deleted: true };
}

async function verifyDocument(client, { accountId, documentId, actor = {} }) {
  const doc = await repo.getDocument(client, documentId);
  if (!doc || doc.treasury_account_id !== accountId) {
    throw new AppError("NOT_FOUND", "Treasury document not found", 404);
  }
  const verifiedBy = await resolveActorId(client, actor.user_id);
  const next = await repo.verifyDocument(client, documentId, verifiedBy);
  await audit(client, {
    actorUserId: actor.user_id || null, action: "treasury_account.document_verified",
    moduleKey: events.MODULE, entityRef: ref(accountId), after: next,
  });
  return next;
}

// ── Signatories (PR-03, Audit #3) ──
async function listSignatories(client, accountId) {
  return repo.listSignatories(client, accountId);
}

async function addSignatory(client, { accountId, actor = {}, ...body }) {
  const acc = await repo.get(client, accountId);
  if (!acc) throw new AppError("NOT_FOUND", "Treasury account not found", 404);
  const createdBy = await resolveActorId(client, actor.user_id);
  const row = await repo.insertSignatory(client, {
    treasury_account_id: accountId,
    created_by: createdBy,
    ...body,
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: "treasury_account.signatory_added",
    moduleKey: events.MODULE, entityRef: ref(accountId), after: row,
  });
  return row;
}

async function updateSignatory(client, { accountId, signatoryId, patch = {}, actor = {} }) {
  const sig = await repo.getSignatory(client, signatoryId);
  if (!sig || sig.treasury_account_id !== accountId) {
    throw new AppError("NOT_FOUND", "Signatory not found", 404);
  }
  const next = await repo.updateSignatory(client, signatoryId, patch);
  await audit(client, {
    actorUserId: actor.user_id || null, action: "treasury_account.signatory_updated",
    moduleKey: events.MODULE, entityRef: ref(accountId), before: sig, after: next,
  });
  return next;
}

async function removeSignatory(client, { accountId, signatoryId, actor = {} }) {
  const sig = await repo.getSignatory(client, signatoryId);
  if (!sig || sig.treasury_account_id !== accountId) {
    throw new AppError("NOT_FOUND", "Signatory not found", 404);
  }
  await repo.deleteSignatory(client, signatoryId);
  await audit(client, {
    actorUserId: actor.user_id || null, action: "treasury_account.signatory_removed",
    moduleKey: events.MODULE, entityRef: ref(accountId), before: sig,
  });
  return { deleted: true };
}

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
  create, update, setActive, setPrimary, verify, unverify, get, list, reverseEntry,
  listDocuments, addDocument, removeDocument, verifyDocument,
  listSignatories, addSignatory, updateSignatory, removeSignatory,
  listGateways, getGateway, upsertGateway, setGatewayActive, setGatewayRole, deleteGateway,
};
