/**
 * Media-attachment outbox repository (PR-07, CE-11 + CE-25).
 *
 * Every piece of SQL for `media_attachment` and for the ground-truth queries
 * the reconciliation repairs from. The outbox rows are BOOKKEEPING; the
 * SELECTs at the bottom read the ground truth (owner columns,
 * document_vault.entity_ref) that the sweep trusts over any recorded state.
 *
 * Nothing in this file mutates the owner tables — the service does that in
 * per-row transactions with audit, so a half-done repair is impossible and a
 * failed one leaves the previous state intact.
 *
 * Table names interpolated by the DOCUMENT_SCAN_TABLES loop below come from a
 * frozen constant in this file, never from a request — the same closed-table
 * pattern nested.js uses for its resource specs.
 */
"use strict";

const { insertOne } = require("../../../shared/db/query-helpers");

/* ── outbox rows ───────────────────────────────────────────────────────────*/

function insert(client, data) {
  return insertOne(client, "media_attachment", data);
}

/**
 * One state transition. Every field is optional except `state`; `bumpAttempts`
 * is a flag rather than a state rule because only `fail()` sets it — a
 * transition that repairs an attempt (LINKED via reconciliation) must not
 * make it look like the operator tried again.
 */
async function update(client, id, { state, vaultDocId, variantKeys, lastError, bumpAttempts }) {
  const sets = ["updated_at = now()"];
  const params = [];
  const push = (sql, value) => {
    params.push(value);
    sets.push(`${sql} = $${params.length}`);
  };
  if (state !== undefined) push("state", state);
  if (vaultDocId !== undefined) push("vault_doc_id", vaultDocId);
  if (variantKeys !== undefined) push("variant_keys", JSON.stringify(variantKeys));
  if (lastError !== undefined) push("last_error", lastError);
  if (bumpAttempts) sets.push("attempts = attempts + 1");
  params.push(id);
  const { rows } = await client.query(
    `UPDATE media_attachment SET ${sets.join(", ")} WHERE attachment_id = $${params.length} RETURNING *`,
    params,
  );
  return rows[0] || null;
}

/**
 * Bulk-close every non-terminal DOCUMENT_SCAN attempt that names this exact
 * attachment. Called from inside the PATCH transaction that lands the link,
 * so an attempt cannot stay open past the moment its link commits.
 */
async function closeForScan(client, { ownerTable, ownerId, vaultDocId, state }) {
  const { rows } = await client.query(
    `UPDATE media_attachment
        SET state = $4, updated_at = now()
      WHERE kind = 'DOCUMENT_SCAN'
        AND owner_table = $1
        AND owner_id = $2
        AND vault_doc_id = $3
        AND state NOT IN ('LINKED', 'RECONCILED')
      RETURNING attachment_id`,
    [ownerTable, ownerId, vaultDocId, state],
  );
  return rows;
}

/**
 * The latest attempt that has not reached a terminal state, for the slot the
 * operator is looking at. Terminal attempts are history: showing them again
 * would teach an administrator that the banner never goes away.
 */
async function latestOpenForOwner(client, { ownerTable, ownerId, slot }) {
  const { rows } = await client.query(
    `SELECT attachment_id, kind, owner_table, owner_id, slot, vault_doc_id,
            state, attempts, last_error, variant_keys, created_at, updated_at
       FROM media_attachment
      WHERE owner_table = $1 AND owner_id = $2
        AND state NOT IN ('LINKED', 'RECONCILED')
        AND ($3::text IS NULL OR slot = $3)
      ORDER BY created_at DESC
      LIMIT 1`,
    [ownerTable, ownerId, slot || null],
  );
  return rows[0] || null;
}

/**
 * Close non-terminal attempts whose vault row can no longer serve — archived
 * by this sweep, or gone entirely. The recorded state then agrees with
 * reality, and the Story tab stops showing a failure whose bytes have just
 * been cleaned up. Idempotent by construction: closed rows no longer match.
 */
async function closeWhereArchivedVault(client) {
  const { rowCount } = await client.query(
    `UPDATE media_attachment a
        SET state = 'RECONCILED', updated_at = now()
      WHERE a.state IN ('INTENT', 'BYTES_STORED', 'FAILED')
        AND a.vault_doc_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM document_vault v
           WHERE v.doc_id = a.vault_doc_id AND v.status <> 'ARCHIVED'
        )`,
  );
  return rowCount || 0;
}

/**
 * INTENT attempts older than the TTL with no bytes behind them: nothing was
 * ever stored, ground truth has nothing to repair, and the attempt is dead.
 * FAILED attempts are deliberately NOT closed here — an attempt the operator
 * was told about stays visible until it is actually resolved, which is the
 * retry-discoverability half of CE-11's acceptance.
 */
async function closeStaleIntents(client, ttlInterval) {
  const { rowCount } = await client.query(
    `UPDATE media_attachment
        SET state = 'RECONCILED', updated_at = now()
      WHERE state = 'INTENT'
        AND vault_doc_id IS NULL
        AND created_at < now() - $1::interval`,
    [ttlInterval],
  );
  return rowCount || 0;
}

/* ── ground truth: what the rows and pointers say RIGHT NOW ────────────────*/

/**
 * The document tables whose scans ride the vault. This list — not a request,
 * not a convention — is what the reconciliation joins on, and it is the same
 * closed set the migration's owner_table CHECK admits. All three carry
 * `document_id` / `vault_id`, which is why the heal and sweep queries below
 * can be written once per table and stay literal.
 */
const DOCUMENT_SCAN_TABLES = Object.freeze([
  { table: "entity_document", pk: "document_id", vaultColumn: "vault_id" },
  { table: "client_document", pk: "document_id", vaultColumn: "vault_id" },
  { table: "supplier_document", pk: "document_id", vaultColumn: "vault_id" },
]);

/**
 * Live vault rows whose entity_ref names a document row that has never been
 * linked — the CE-11 "bytes stored, link missing" state, read from the rows
 * themselves so it is true for attempts that predate the outbox entirely.
 *
 * Text comparison, not a uuid cast: entity_ref is free text, and a malformed
 * value must read as "no claim" rather than crash the sweep with a cast
 * error.
 */
function claimableDocumentScans(client, { table, pk, vaultColumn }) {
  return client.query(
    `SELECT v.doc_id, v.entity_ref, v.storage_path, v.created_at,
            split_part(v.entity_ref, ':', 2) AS owner_id
       FROM document_vault v
       JOIN ${table} d ON d.${pk}::text = split_part(v.entity_ref, ':', 2)
      WHERE v.entity_ref LIKE '${table}:%'
        AND v.status <> 'ARCHIVED'
        AND v.storage_path NOT LIKE 'pending://%'
        AND d.${vaultColumn} IS NULL
      ORDER BY v.created_at DESC`,
  );
}

/**
 * Vault rows that name a document row but were never linked and never will
 * be. TWO conditions, and the second is what keeps this from deleting
 * evidence:
 *
 *   · the named document row either no longer exists (deleted while the
 *     upload waited) or points at a different vault row — so nothing will
 *     ever link THIS one;
 *   · a non-terminal outbox attempt names this vault row — the linkage was
 *     intended through this module's flow and never landed. A SUPERSEDED
 *     scan (an attempt that reached LINKED, then the pointer moved on) has
 *     no non-terminal attempt, and neither does a legacy or hand-uploaded
 *     row: both keep the vault's ordinary retention rather than losing
 *     their bytes to a sweep that could not tell them apart.
 */
function unclaimedDocumentScanVaultRows(client, { table, pk, vaultColumn }, ttlInterval) {
  return client.query(
    `SELECT DISTINCT v.doc_id, v.entity_ref, v.storage_path, v.created_at,
            split_part(v.entity_ref, ':', 2) AS owner_id
       FROM document_vault v
       JOIN media_attachment a
         ON a.vault_doc_id = v.doc_id
        AND a.kind = 'DOCUMENT_SCAN'
        AND a.state IN ('INTENT', 'BYTES_STORED', 'FAILED')
       LEFT JOIN ${table} d ON d.${pk}::text = split_part(v.entity_ref, ':', 2)
      WHERE v.entity_ref LIKE '${table}:%'
        AND v.status <> 'ARCHIVED'
        AND v.created_at < now() - $1::interval
        AND (d.${pk} IS NULL OR d.${vaultColumn} <> v.doc_id
             OR d.${vaultColumn} IS NULL)`,
    [ttlInterval],
  );
}

/**
 * SITE_MEDIA vault objects created before an owner-pointer commit that never
 * came (CE-25). An object is an orphan when ALL of these hold:
 *
 *   · it was never scoped public — the scope UPDATE is inside the transaction
 *     that failed, so a NULL scope IS the failed-commit fingerprint;
 *   · it is not archived, so the sweep's own earlier work cannot re-match;
 *   · it is older than the TTL — a replacement in flight right now is
 *     byte-identical to a dead one, and only age tells them apart;
 *   · no owner column points at it — the check the serve route makes on
 *     every request, restated here, because a surviving pointer means the
 *     transaction COMMITTED and these bytes are the live cover.
 *
 * The four owner checks are the OWNERS register from site_settings.media.js
 * restated in SQL. They are written out rather than derived because a sweep
 * that guessed the pointer columns would be a second source of truth for
 * them — the exact drift this module exists to prevent.
 */
async function orphanSiteMedia(client, ttlInterval) {
  const { rows } = await client.query(
    `SELECT v.doc_id, v.entity_ref, v.storage_path, v.created_at
       FROM document_vault v
      WHERE v.doc_type = 'SITE_MEDIA'
        AND v.public_media_scope IS NULL
        AND v.status <> 'ARCHIVED'
        AND v.created_at < now() - $1::interval
        AND NOT EXISTS (SELECT 1 FROM corporate_entity o WHERE o.public_cover_vault_id = v.doc_id)
        AND NOT EXISTS (SELECT 1 FROM site_leader o WHERE o.photo_vault_id = v.doc_id)
        AND NOT EXISTS (SELECT 1 FROM site_partner o WHERE o.logo_vault_id = v.doc_id)
        AND NOT EXISTS (SELECT 1 FROM site_credential o WHERE o.logo_vault_id = v.doc_id)`,
    [ttlInterval],
  );
  return rows;
}

/** A vault row by id — the sweep reads it before archiving so the audit
 *  carries a `before`, not a memory of one. */
async function vaultRow(client, docId) {
  const { rows } = await client.query(
    "SELECT doc_id, doc_type, entity_ref, storage_path, status, public_media_scope FROM document_vault WHERE doc_id = $1",
    [docId],
  );
  return rows[0] || null;
}

/**
 * Archive a SITE_MEDIA orphan — WITH THE OWNER-POINTER GUARDS IN THE WHERE
 * CLAUSE, not in a pre-read.
 *
 * The sweep SELECTs candidates, then works through them one at a time; a
 * replacement whose pointer transaction commits between the two would make a
 * pre-read stale, and archiving the object an owner has just claimed is the
 * one way this job could break the public site. With the four NOT EXISTS
 * checks in the statement itself, the archive and the claim are one atomic
 * decision: whichever commits first wins, and the loser matches zero rows.
 *
 * The four checks are the OWNERS register from site_settings.media.js,
 * restated exactly as the orphan SELECT carries them.
 */
async function archiveOrphanSiteMediaRow(client, docId) {
  const { rows } = await client.query(
    `UPDATE document_vault v
        SET status = 'ARCHIVED', updated_at = now()
      WHERE v.doc_id = $1
        AND v.status <> 'ARCHIVED'
        AND v.public_media_scope IS NULL
        AND NOT EXISTS (SELECT 1 FROM corporate_entity o WHERE o.public_cover_vault_id = v.doc_id)
        AND NOT EXISTS (SELECT 1 FROM site_leader o WHERE o.photo_vault_id = v.doc_id)
        AND NOT EXISTS (SELECT 1 FROM site_partner o WHERE o.logo_vault_id = v.doc_id)
        AND NOT EXISTS (SELECT 1 FROM site_credential o WHERE o.logo_vault_id = v.doc_id)
      RETURNING v.doc_id, v.status`,
    [docId],
  );
  return rows[0] || null;
}

/**
 * Archive a never-linked document scan — same guarded shape as the SITE_MEDIA
 * archive: the statement itself re-asserts that no document row points at
 * this vault object and that a non-terminal attempt (the linkage intent) is
 * still on record. If the operator's retried PATCH lands first, the UPDATE
 * matches nothing and the sweep stands down.
 */
async function archiveUnclaimedScanRow(client, docId) {
  const { rows } = await client.query(
    `UPDATE document_vault v
        SET status = 'ARCHIVED', updated_at = now()
      WHERE v.doc_id = $1
        AND v.status <> 'ARCHIVED'
        AND EXISTS (
          SELECT 1 FROM media_attachment a
           WHERE a.vault_doc_id = v.doc_id
             AND a.kind = 'DOCUMENT_SCAN'
             AND a.state IN ('INTENT', 'BYTES_STORED', 'FAILED')
        )
        AND NOT EXISTS (
          SELECT 1 FROM entity_document d
           WHERE ('entity_document:' || d.document_id::text) = v.entity_ref
             AND d.vault_id = v.doc_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM client_document d
           WHERE ('client_document:' || d.document_id::text) = v.entity_ref
             AND d.vault_id = v.doc_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM supplier_document d
           WHERE ('supplier_document:' || d.document_id::text) = v.entity_ref
             AND d.vault_id = v.doc_id
        )
      RETURNING v.doc_id, v.status`,
    [docId],
  );
  return rows[0] || null;
}

/**
 * The derivative keys a SITE_MEDIA attempt recorded for this vault row — the
 * exact list of what writeVariants put beside the master. The vault row's own
 * public_media_variants cannot serve here: that column is written by the
 * owner-pointer transaction, which is precisely the transaction that failed.
 */
async function variantKeysForVault(client, docId) {
  const { rows } = await client.query(
    `SELECT variant_keys
       FROM media_attachment
      WHERE vault_doc_id = $1 AND kind = 'SITE_MEDIA'
      ORDER BY created_at DESC
      LIMIT 1`,
    [docId],
  );
  const parsed = rows[0] && rows[0].variant_keys;
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Which of these document rows have live, real bytes waiting under their
 * entity_ref with no link yet — the flag the register renders as "stored,
 * link pending" (CE-11 made visible rather than inferred). Callers pass only
 * rows whose own vault_id is NULL; the vault-side check here is on refs, so
 * a document linked to a different file is not flagged by its superseded one.
 */
async function documentIdsWithStoredUnlinkedScan(client, ownerTable, ids) {
  if (!ids.length) return new Set();
  const refs = ids.map((id) => `${ownerTable}:${id}`);
  const { rows } = await client.query(
    `SELECT DISTINCT split_part(entity_ref, ':', 2) AS owner_id
       FROM document_vault
      WHERE entity_ref = ANY($1::text[])
        AND status <> 'ARCHIVED'
        AND storage_path NOT LIKE 'pending://%'`,
    [refs],
  );
  return new Set(rows.map((r) => r.owner_id));
}

module.exports = {
  DOCUMENT_SCAN_TABLES,
  insert,
  update,
  closeForScan,
  latestOpenForOwner,
  closeWhereArchivedVault,
  closeStaleIntents,
  claimableDocumentScans,
  unclaimedDocumentScanVaultRows,
  orphanSiteMedia,
  vaultRow,
  archiveOrphanSiteMediaRow,
  archiveUnclaimedScanRow,
  variantKeysForVault,
  documentIdsWithStoredUnlinkedScan,
};
