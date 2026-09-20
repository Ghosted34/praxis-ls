/**
 * Media-attachment outbox service (PR-07, CE-11 + CE-25).
 *
 * ── WHAT THIS IS ───────────────────────────────────────────────────────────
 *
 * The durable state machine for putting bytes behind a record. Two workflows
 * write bytes before the pointer that owns them, and until now the gap
 * between the two was unnamed:
 *
 *   · a website slot upload (site_settings.media.upload) — the vault object
 *     and its derivatives are stored BEFORE the transaction that scopes the
 *     object public, points the owner column at it and archives the replaced
 *     document. A failure in that transaction left an unowned object nobody
 *     would ever reference, while the old cover kept serving (CE-25).
 *   · a document scan — three requests (row, upload, link PATCH) whose middle
 *     failure left bytes that existed and a register that said "no scan yet"
 *     (CE-11).
 *
 * Every attempt now writes an outbox row FIRST, and the state names exactly
 * what exists:
 *
 *   INTENT         record yes, bytes no, link no.
 *   BYTES_STORED   record yes, bytes yes (vault_doc_id), link no.
 *   LINKED         record yes, bytes yes, link yes. Terminal.
 *   FAILED         an error was caught; vault_doc_id still says whether the
 *                  bytes exist. Shown in the Story tab until resolved.
 *   RECONCILED     the reconciliation completed the link, or swept the
 *                  orphaned bytes and archived the vault row. Terminal.
 *
 * ── THE OUTBOX IS BOOKKEEPING, NOT TRUTH ───────────────────────────────────
 *
 * A crash between the bytes and the bookkeeping leaves a row that understates
 * what exists. So the reconciliation never trusts the recorded state alone:
 * it repairs from ground truth — the owner columns, document_vault.entity_ref
 * and the storage keys the attempt recorded — and then updates the outbox to
 * agree. That is also why it heals attachments that predate this table: the
 * "bytes stored, link missing" condition is derivable from the rows
 * themselves.
 *
 * ── PUBLIC SAFETY, STATED AS AN INVARIANT OF THE SWEEP ────────────────────
 *
 * The sweep may only ever archive a vault object that NO owner column points
 * at and NOTHING can serve. That check is not a pre-read — it is in the WHERE
 * clause of the archiving UPDATE itself, so a replacement committing while
 * the sweep runs loses the race and the sweep's UPDATE matches zero rows. A
 * failed replacement therefore leaves the previous cover servable, and a
 * failed new upload is never publishable, no matter when anything crashes.
 */
"use strict";

const repo = require("./attachment_outbox.repo");
const variants = require("./attachment_variants");
const imagePipeline = require("../../../services/image-pipeline.service");
const storage = require("../../../services/storage.service");
const { audit, resolveActorId } = require("../../../shared/events/emit");
const { atomically } = require("../../../shared/db/tx");
const { logger } = require("../../../config/logger");
const metrics = require("../../../shared/observability/metrics");

const MODULE_KEY = "MOD-64";

/** How long an orphan waits before the sweep may take it. Long enough that a
 *  replacement in flight, a retried PATCH or a slow commute is never mistaken
 *  for an abandoned upload; short enough that failed uploads do not
 *  accumulate. The job passes its own; this is the floor for direct callers. */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

const errText = (e) =>
  String((e && e.message) || e || "unknown error").slice(0, 500);

/*
 * PR-10 / B.2: the reconciliation's RETURN VALUE was the only record of what a
 * pass did — visible to whichever caller logged it, invisible to everyone
 * else. Each outcome now also increments a counter beside the out.* tally it
 * belongs to, so a dashboard can watch the sweep work (and a counter that
 * never moves catches a sweep that stopped running) without reading job logs.
 */
const RECONCILE_METRIC = (result, value = 1) => {
  // A zero is not an outcome. Emitting result=outbox_closed=0 for every
  // quiet pass would create a label series that never did anything — noise
  // for a scraper and a false "activity" line in a dashboard listing.
  if (!Number(value)) return;
  metrics.inc(
    "praxis_media_reconciliation_total",
    { result },
    value,
    "Media reconciliation outcomes: document links completed, orphans swept, storage keys deleted, delete failures, outbox rows closed.",
  );
};

/* ── the state machine, as the upload paths drive it ───────────────────────*/

/** Record the intent before anything is stored. The INSERT commits on its
 *  own: if the upload dies at once, the attempt is already named. */
async function begin(client, { kind, ownerTable, ownerId, slot = null, actor = {} }) {
  return repo.insert(client, {
    kind,
    owner_table: ownerTable,
    owner_id: ownerId,
    slot,
    state: "INTENT",
    // The row lands in the request's schema; the actor id may live only in
    // LIVE. Resolved, not assumed (DATA 2.4) — the sweep and the Story tab
    // read this column for forensics, and an id that resolves nowhere is a
    // lie with a uuid's shape.
    created_by: await resolveActorId(client, actor.user_id),
  });
}

/** Bytes are in storage and the vault row exists. Called the moment
 *  createDocument returns — before the derivatives, before the pointer
 *  transaction — so a crash from here on leaves a row that says so. */
function markBytesStored(client, attachmentId, vaultDocId) {
  return repo.update(client, attachmentId, { state: "BYTES_STORED", vaultDocId });
}

/** The derivative keys actually written beside the master. Recorded before
 *  the owner-pointer transaction because that transaction is the one whose
 *  failure orphans them (CE-25): its own public_media_variants UPDATE never
 *  lands, so this list is the only durable record of what to delete. */
function recordVariantKeys(client, attachmentId, keys) {
  return repo.update(client, attachmentId, { variantKeys: keys });
}

/** Terminal success — called INSIDE the pointer transaction, so the row can
 *  never say LINKED while the link is rolling back. */
function markLinked(client, attachmentId) {
  return repo.update(client, attachmentId, { state: "LINKED" });
}

/** A document PATCH landed a scan link: close every non-terminal attempt
 *  naming that exact attachment. Called from inside the PATCH transaction. */
function markScanLinked(client, { ownerTable, ownerId, vaultDocId }) {
  return repo.closeForScan(client, { ownerTable, ownerId, vaultDocId, state: "LINKED" });
}

/**
 * An attempt failed. BEST-EFFORT BY CONTRACT: this runs after the original
 * error has already been raised, often over a connection that just failed a
 * transaction — a second failure here must never mask the first. The row's
 * state is the casualty we can afford; the operator's error message is not.
 */
async function fail(client, attachmentId, error) {
  try {
    return await repo.update(client, attachmentId, {
      state: "FAILED",
      lastError: errText(error),
      bumpAttempts: true,
    });
  } catch (bookkeepingErr) {
    logger.warn(
      { err: bookkeepingErr, attachmentId },
      "media outbox: could not record the FAILED state — the attempt stays in its previous state and the sweep will reconcile it from ground truth",
    );
    return null;
  }
}

/** The vault-upload half of a document scan, recorded by the vault's upload
 *  controller when the caller's entity_ref names a document row. The record
 *  already exists (the document was created first); the bytes just landed;
 *  the link is the PATCH that has not happened yet. */
async function recordScanUpload(client, { ownerTable, ownerId, vaultDocId, actor = {} }) {
  return repo.insert(client, {
    kind: "DOCUMENT_SCAN",
    owner_table: ownerTable,
    owner_id: ownerId,
    vault_doc_id: vaultDocId,
    state: "BYTES_STORED",
    created_by: await resolveActorId(client, actor.user_id),
  });
}

/** The latest non-terminal attempt for an owner — what the Story tab shows
 *  next to the slot, so a failed upload stays visible until it is resolved
 *  rather than until the operator navigates away. */
const latestOpenForOwner = (client, q) => repo.latestOpenForOwner(client, q);

/**
 * Stamp document rows that have bytes waiting under their entity_ref with no
 * link yet — "file stored, link pending", visible on the register instead of
 * being inferred from a PENDING pill that means "no file at all".
 *
 * Only rows whose OWN vault_id is NULL are candidates: a document linked to
 * file B is not waiting for the superseded file A still sitting in the vault.
 */
async function annotateUnlinkedScans(client, ownerTable, rows) {
  const waiting = rows.filter((r) => r && !r.vault_id && r.document_id);
  if (!waiting.length) return rows;
  const withBytes = await repo.documentIdsWithStoredUnlinkedScan(
    client,
    ownerTable,
    waiting.map((r) => r.document_id),
  );
  if (!withBytes.size) return rows;
  return rows.map((r) =>
    r && !r.vault_id && withBytes.has(r.document_id)
      ? { ...r, scan_stored_unlinked: true }
      : r,
  );
}

/* ── the reconciliation ────────────────────────────────────────────────────*/

/**
 * Every storage key an orphaned upload may have written, so the sweep deletes
 * exactly what the writer wrote. Three sources, deliberately unioned:
 *
 *   · the master key from the vault row — always exact;
 *   · the pipeline derivatives — `<master>.<variant>.<format>` for the two
 *     variants the document profile writes, derived the same way the writer
 *     derived them (imagePipeline.derivativeKey);
 *   · the site ladder — both what the attempt RECORDED (exact) and the full
 *     candidate ladder (for the crash window between writing the last
 *     derivative and recording it).
 *
 * Candidate keys that were never written simply fail ENOENT on delete and are
 * tolerated — a key nobody wrote is not an error the sweep should report.
 */
function byteKeysFor(storagePath, recordedVariantKeys) {
  const keys = new Set([String(storagePath || "")].filter(Boolean));
  for (const variant of ["thumb", "preview"]) {
    for (const format of variants.VARIANT_FORMATS) {
      keys.add(imagePipeline.derivativeKey(storagePath, variant, format));
    }
  }
  for (const width of variants.VARIANT_WIDTHS) {
    for (const format of variants.VARIANT_FORMATS) {
      keys.add(variants.variantKey(storagePath, width, format));
    }
  }
  for (const key of Array.isArray(recordedVariantKeys) ? recordedVariantKeys : []) {
    if (typeof key === "string" && key) keys.add(key);
  }
  return [...keys];
}

/** Delete one key. ENOENT is the expected answer for candidates that were
 *  never written; anything else is counted, not thrown — one unreachable key
 *  must not abort the sweep with the rest of the tenant still to do. */
async function deleteKey(key, out) {
  try {
    await storage.delete(key);
    out.bytes_deleted += 1;
    RECONCILE_METRIC("bytes_deleted");
  } catch (err) {
    if (err && err.code === "ENOENT") return;
    out.byte_failures += 1;
    RECONCILE_METRIC("byte_failures");
    logger.warn({ err, key }, "media reconciliation: storage delete failed");
  }
}

/**
 * Sweep one orphan: archive the vault row and its audit entry in ONE
 * transaction, then delete the bytes it parked in storage.
 *
 * ORDER MATTERS. The row is archived first and the bytes deleted only after
 * that commit: a sweep that deleted bytes under a live row would leave a
 * VERIFIED document whose every read 404s — worse than the orphan it was
 * cleaning up. If the guarded archive matches zero rows (a replacement
 * committed first, or an earlier pass already archived), the bytes are
 * skipped: they are not this sweep's to take.
 */
async function sweepVaultRow(client, vaultDocId, out) {
  const before = await repo.vaultRow(client, vaultDocId);
  if (!before || before.status === "ARCHIVED") return;

  const isSiteMedia = before.doc_type === "SITE_MEDIA";
  let archived = null;

  await atomically(client, async () => {
    archived = isSiteMedia
      ? await repo.archiveOrphanSiteMediaRow(client, vaultDocId)
      : await repo.archiveUnclaimedScanRow(client, vaultDocId);
    if (!archived) return; // guarded WHERE matched nothing — the ground truth moved first
    await audit(client, {
      actorUserId: null,
      action: isSiteMedia
        ? "media_reconciliation.site_media_orphan_swept"
        : "media_reconciliation.unlinked_scan_swept",
      moduleKey: MODULE_KEY,
      entityRef: `document_vault:${vaultDocId}`,
      before,
      after: archived,
      metadata: {
        reason: isSiteMedia
          ? "SITE_MEDIA object created before an owner-pointer commit that never came (CE-25)"
          : "document scan bytes never linked (CE-11)",
      },
    });
  });
  if (!archived) return;
  out.swept += 1;
  RECONCILE_METRIC("swept");

  const recorded = isSiteMedia
    ? await repo.variantKeysForVault(client, vaultDocId)
    : null;
  for (const key of byteKeysFor(before.storage_path, recorded)) {
    await deleteKey(key, out);
  }
}

/**
 * One reconciliation pass. Safe to re-run at any time, from any state:
 *
 *   Phase 1 completes document links from ground truth — a live vault row
 *   whose entity_ref names a document whose vault_id is still NULL is linked
 *   (latest wins), the scan pill advances PENDING → SCANNED exactly as the
 *   PATCH would have, and the outbox rows close. Once linked, the predicate
 *   no longer matches, so re-running does nothing.
 *
 *   Phase 2 sweeps orphans — SITE_MEDIA objects with no scope, no pointer and
 *   no future (past the TTL), and document-scan bytes whose attempt never
 *   landed a link and never will. The archiving UPDATE itself re-asserts that
 *   nothing points at the row, so a concurrent replacement wins and the sweep
 *   stands down. Archived rows no longer match, so re-running does nothing.
 *
 *   Phase 3 closes the bookkeeping — attempts whose vault row the sweep
 *   archived, whose vault row vanished, or whose INTENT outlived the TTL
 *   with nothing behind it.
 *
 * LIVE tenants only, by the scheduler that calls it: the sweep DELETES
 * storage bytes, and a bug that misjudges an orphan should have to do so in
 * the environment where an operator is watching, not the sandbox a test
 * tenant shares with production code paths.
 */
async function reconcile(client, { ttlMs = DEFAULT_TTL_MS, actor = {} } = {}) {
  const ttlInterval = `${Math.max(1, Math.round(ttlMs / 1000))} seconds`;
  const out = {
    linked: 0,
    swept: 0,
    bytes_deleted: 0,
    byte_failures: 0,
    outbox_closed: 0,
  };

  /* Phase 1 — complete the links (CE-11). */
  for (const t of repo.DOCUMENT_SCAN_TABLES) {
    const { rows } = await repo.claimableDocumentScans(client, t);
    // Newest first, one claim per document: the most recent attempt is the
    // one the operator meant. Older ones fall to phase 2 as unclaimed.
    const latest = new Map();
    for (const r of rows) if (!latest.has(r.owner_id)) latest.set(r.owner_id, r);
    for (const [ownerId, claim] of latest) {
      await atomically(client, async () => {
        // The WHERE re-asserts the claim inside the transaction: if the PATCH
        // the operator retried lands first, this matches nothing and the
        // sweep defers to it.
        const upd = await client.query(
          `UPDATE ${t.table}
              SET ${t.vaultColumn} = $2,
                  scan_status = CASE WHEN scan_status = 'PENDING' THEN 'SCANNED' ELSE scan_status END,
                  updated_at = now()
            WHERE ${t.pk} = $1 AND ${t.vaultColumn} IS NULL
            RETURNING *`,
          [ownerId, claim.doc_id],
        );
        if (!upd.rows[0]) return;
        await audit(client, {
          actorUserId: actor.user_id || null,
          action: "media_reconciliation.document_scan_linked",
          moduleKey: MODULE_KEY,
          entityRef: `${t.table}:${ownerId}`,
          before: { [t.vaultColumn]: null },
          after: { [t.vaultColumn]: claim.doc_id, scan_status: upd.rows[0].scan_status },
          metadata: { vault_doc_id: claim.doc_id, reason: "scan bytes were stored but the link PATCH never landed (CE-11)" },
        });
        await repo.closeForScan(client, {
          ownerTable: t.table,
          ownerId,
          vaultDocId: claim.doc_id,
          state: "LINKED",
        });
        out.linked += 1;
        RECONCILE_METRIC("linked");
      });
    }
  }

  /* Phase 2 — sweep the orphans (CE-25, and CE-11's unlinked bytes). */
  for (const row of await repo.orphanSiteMedia(client, ttlInterval)) {
    await sweepVaultRow(client, row.doc_id, out);
  }
  for (const t of repo.DOCUMENT_SCAN_TABLES) {
    const { rows } = await repo.unclaimedDocumentScanVaultRows(client, t, ttlInterval);
    for (const row of rows) {
      await sweepVaultRow(client, row.doc_id, out);
    }
  }

  /* Phase 3 — close the bookkeeping. */
  const closedArchived = await repo.closeWhereArchivedVault(client);
  out.outbox_closed += closedArchived;
  RECONCILE_METRIC("outbox_closed", closedArchived);
  const closedStale = await repo.closeStaleIntents(client, ttlInterval);
  out.outbox_closed += closedStale;
  RECONCILE_METRIC("outbox_closed", closedStale);

  return out;
}

module.exports = {
  DEFAULT_TTL_MS,
  STATES: Object.freeze(["INTENT", "BYTES_STORED", "LINKED", "FAILED", "RECONCILED"]),
  begin,
  markBytesStored,
  recordVariantKeys,
  markLinked,
  markScanLinked,
  fail,
  recordScanUpload,
  latestOpenForOwner,
  annotateUnlinkedScans,
  reconcile,
  byteKeysFor,
};
