/**
 * Read-only ledger CRUD (generic) plus restore-from-soft-delete — the
 * "Two-tier deletion model" gap in WORK_TO_BE_DONE.md: "soft_delete rows
 * can be written but nothing reads them back to actually restore a
 * record." Maker-checker two-step, matching the DB's own CHECK
 * (restored_by <> deleted_by) and the RBAC journey doc's "Second Admin
 * co-approves restores": requestRestore() flags intent, restore() is the
 * second, different admin actually confirming it.
 *
 * Deliberately NOT God Mode: godmode.service.js's purge is CEO-PIN-gated
 * and irreversible by design; this is the everyday, reversible path
 * ("Super Admin: soft-delete; restore" — no PIN, just the MOD-69 grant).
 */
"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const entityRegistry = require("../../../shared/crud/entity-registry");
const repo = require("./audit_ledger.repo");
const events = require("./audit_ledger.events");

const crud = makeService({ repo, moduleKey: events.MODULE, entity: "audit_ledger", events });

const listSoftDeletes = (client, q) => repo.listSoftDeletes(client, q);

async function requestRestore(client, { id, actor }) {
  const row = await repo.requestRestore(client, id, actor.user_id);
  if (!row) {
    throw new AppError("NOT_FOUND", "Soft-delete record not found or already restored", 404);
  }
  await emitEvent(client, {
    eventTypeKey: events.RESTORE_REQUESTED,
    moduleKey: events.MODULE,
    entityRef: row.entity_ref,
    actorUserId: actor.user_id,
  });
  return row;
}

async function restore(client, { id, actor }) {
  const row = await repo.getSoftDelete(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Soft-delete record not found", 404);
  if (row.restored_at) throw new AppError("ALREADY_RESTORED", "Already restored", 409);

  // Maker-checker — checked here first for a clean 403 (the DB's own CHECK
  // constraint would also reject this, but as a raw 500).
  if (row.deleted_by && row.deleted_by === actor.user_id) {
    throw new AppError(
      "FORBIDDEN",
      "The person who deleted a record cannot restore it themselves — needs a second admin",
      403,
    );
  }

  const [entity, pkValue] = String(row.entity_ref || "").split(":");
  const meta = entityRegistry.getEntityMeta(entity);
  if (!meta) {
    throw new AppError(
      "RESTORE_NOT_SUPPORTED",
      `No known table for entity "${entity}" — can't restore automatically`,
      422,
    );
  }

  const exists = await repo.rowExists(client, meta.table, meta.pk, pkValue);
  if (!exists) {
    await repo.reinsertFromPayload(client, meta.table, row.payload_json);
  } else if (meta.activeColumn) {
    await repo.reactivate(client, meta.table, meta.pk, meta.activeColumn, pkValue);
  }
  // else: the table has no activeColumn, so "delete" never actually hid
  // the row — soft_delete was the only record a delete happened. Marking
  // it restored below is the whole fix in that case.

  const restored = await repo.markRestored(client, id, actor.user_id);
  await emitEvent(client, {
    eventTypeKey: events.RESTORED,
    moduleKey: events.MODULE,
    entityRef: row.entity_ref,
    actorUserId: actor.user_id,
  });
  await audit(client, {
    actorUserId: actor.user_id,
    action: events.RESTORED,
    moduleKey: events.MODULE,
    entityRef: row.entity_ref,
    after: row.payload_json,
  });
  return restored;
}

// ── Access reviews (4.1) ──
const REVIEW_DECISIONS = ["approved", "revoked", "flagged"];

async function createReview(client, { name, actor }) {
  const review = await repo.createReview(client, { name, createdBy: actor.user_id });
  await repo.snapshotEntries(client, review.review_id);
  await audit(client, { actorUserId: actor.user_id, action: "access_review.created", moduleKey: events.MODULE, entityRef: "access_review:" + review.review_id, after: review });
  return review;
}
const listReviews = (client, q) => repo.listReviews(client, q);
async function getReview(client, id) {
  const review = await repo.getReview(client, id);
  if (!review) throw new AppError("NOT_FOUND", "Access review not found", 404);
  const entries = await repo.listEntries(client, id);
  return { ...review, entries };
}
async function decideEntry(client, { reviewId, entryId, decision, note, actor }) {
  if (!REVIEW_DECISIONS.includes(decision)) {
    throw new AppError("BAD_DECISION", "decision must be " + REVIEW_DECISIONS.join("|"), 422);
  }
  const row = await repo.decideEntry(client, { reviewId, entryId, decision, note, decidedBy: actor.user_id });
  if (!row) throw new AppError("NOT_FOUND", "Review entry not found", 404);
  await audit(client, { actorUserId: actor.user_id, action: "access_review.entry.decided", moduleKey: events.MODULE, entityRef: "access_review_entry:" + entryId, after: row });
  return row;
}
async function completeReview(client, { id, actor }) {
  const row = await repo.completeReview(client, { id, completedBy: actor.user_id });
  if (!row) throw new AppError("NOT_FOUND", "Access review not found or already completed", 404);
  await audit(client, { actorUserId: actor.user_id, action: "access_review.completed", moduleKey: events.MODULE, entityRef: "access_review:" + id, after: row });
  return row;
}

// ── Security-events read (4.2) ──
const listSecurityEvents = (client, q) => repo.listSecurityEvents(client, q);

module.exports = {
  ...crud, listSoftDeletes, requestRestore, restore,
  createReview, listReviews, getReview, decideEntry, completeReview,
  listSecurityEvents,
};
