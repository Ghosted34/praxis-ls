/**
 * Document-signature repository (MOD-64). The only place with SQL for
 * document_signature, per doc/CONVENTIONS.md.
 *
 * A note that governs everything here: a signature row is INSERT-only. It is
 * never updated except to set the revocation triple, and never deleted. The
 * entire audit value of this table is that "who attested to which exact
 * figures, and when" survives every later edit — so there is deliberately no
 * update() and no remove().
 */
"use strict";

const { insertOne, listComplete } = require("../../../shared/db/query-helpers");

const COLS = `signature_id, entity_ref, doc_type, document_vault_id,
  payload_version, content_hash, content_payload, artifact_hash,
  assurance_level, visual_mark, preset_code, sign_reason,
  party, identity_source, signer_user_id, signer_name, signer_role, signer_email,
  signature_request_id, mark_image_b64, verify_code,
  signed_at, ip, user_agent, otp_challenge_id,
  revoked_at, revoked_by, revoke_reason, created_at`;

function insert(client, data) {
  return insertOne(client, "document_signature", data);
}

async function getById(client, id) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM document_signature WHERE signature_id = $1`, [id],
  );
  return rows[0] || null;
}

/** Public-portal lookup. Exact match on the plaintext code's unique index. */
async function getByVerifyCode(client, code) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM document_signature WHERE verify_code = $1`, [code],
  );
  return rows[0] || null;
}

async function listByRef(client, entityRef) {
  const { rows } = await listComplete(
    client,
    `SELECT ${COLS} FROM document_signature WHERE entity_ref = $1 ORDER BY signed_at DESC`,
    [entityRef],
    { label: "Document signatures", ceiling: 5000 },
  );
  return rows;
}

/** Signatures that are still live for a document — used to decide re-render. */
async function countActive(client, entityRef) {
  const { rows } = await client.query(
    "SELECT count(*)::int AS n FROM document_signature WHERE entity_ref = $1 AND revoked_at IS NULL",
    [entityRef],
  );
  return rows[0].n;
}

async function revoke(client, { id, actorUserId, reason }) {
  const { rows } = await client.query(
    `UPDATE document_signature
        SET revoked_at = now(), revoked_by = $2, revoke_reason = $3
      WHERE signature_id = $1 AND revoked_at IS NULL
      RETURNING ${COLS}`,
    [id, actorUserId, reason],
  );
  return rows[0] || null;
}

/** Written back once the document has been rendered and vaulted. */
async function setArtifact(client, { id, documentVaultId, artifactHash }) {
  const { rows } = await client.query(
    `UPDATE document_signature
        SET document_vault_id = COALESCE($2, document_vault_id),
            artifact_hash     = COALESCE($3, artifact_hash)
      WHERE signature_id = $1
      RETURNING ${COLS}`,
    [id, documentVaultId, artifactHash],
  );
  return rows[0] || null;
}

/**
 * Serialise the amendment side effects for one signature.
 *
 * Two concurrent reads of an amended document would otherwise each raise a
 * compliance flag and each notify the signer. A transaction-scoped advisory
 * lock (the idiom journal_entry.repo uses) makes the second wait, see the flag
 * the first wrote, and do nothing.
 */
function lockForAmendment(client, signatureId) {
  return client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["signature:amend:" + signatureId]);
}

async function amendmentFlagExists(client, entityRef) {
  const { rows } = await client.query(
    "SELECT 1 FROM compliance_flag WHERE rule_key = $1 AND entity_ref = $2 AND resolved_at IS NULL LIMIT 1",
    ["signature.amended_after_signing", entityRef],
  );
  return Boolean(rows[0]);
}

function raiseAmendmentFlag(client, { entityRef, message }) {
  return client.query(
    "INSERT INTO compliance_flag (rule_key, entity_ref, severity, message) VALUES ($1, $2, $3, $4)",
    ["signature.amended_after_signing", entityRef, "RED", message],
  );
}

// ── signature_scan (10779) ─────────────────────────────────────────────────
//
// The scan log lives in THIS repo, not the portal's, because a scan is a child
// of a signature: FK'd to it, cascade-deleted with it, and meaningless without
// it. The portal module reads through here rather than writing its own SQL, so
// "the only place with SQL for document_signature" stays true of its children
// too (doc/CONVENTIONS.md).

const SCAN_COLS = "scan_id, signature_id, scanned_at, ip, user_agent, referrer, via, is_new_ip";

/**
 * Has this address verified this signature before?
 *
 * A null IP answers `true` — "not new" — on purpose. The alternative is to
 * treat every unknown address as a first sighting, which would fire a new-IP
 * notification on every scan from a client we cannot place. A control that
 * cries wolf gets switched off, and this one is off by default already.
 */
async function scanSeenFromIp(client, signatureId, ip) {
  if (!ip) return true;
  const { rows } = await client.query(
    "SELECT 1 FROM signature_scan WHERE signature_id = $1 AND ip = $2::inet LIMIT 1",
    [signatureId, ip],
  );
  return Boolean(rows[0]);
}

function insertScan(client, data) {
  return insertOne(client, "signature_scan", data);
}

/** Scans on one signature inside a rolling window. Feeds the anomaly signal. */
async function countScansInWindow(client, signatureId, minutes) {
  const { rows } = await client.query(
    "SELECT count(*)::int AS n FROM signature_scan "
      + "WHERE signature_id = $1 AND scanned_at > now() - ($2::int * interval '1 minute')",
    [signatureId, minutes],
  );
  return rows[0].n;
}

/** The internal "who scanned this" tab. Newest first; IPs masked by the caller. */
async function listScans(client, signatureId, limit = 200) {
  const { rows } = await client.query(
    `SELECT ${SCAN_COLS} FROM signature_scan WHERE signature_id = $1 ORDER BY scanned_at DESC LIMIT $2`,
    [signatureId, Math.min(Number(limit) || 200, 1000)],
  );
  return rows;
}

/** Counts for the header of that tab: how many, from how many places, when last. */
async function scanSummary(client, signatureId) {
  const { rows } = await client.query(
    "SELECT count(*)::int AS total, count(DISTINCT ip)::int AS distinct_ips, max(scanned_at) AS last_scan_at "
      + "FROM signature_scan WHERE signature_id = $1",
    [signatureId],
  );
  return rows[0];
}

/**
 * Retention sweep. `ip` is personal data and signature_policy.scan_retention_days
 * (default 400) is the tenant's answer for how long it may be held. The
 * immutable_ledger copy is governed by its own rules and is NOT touched here.
 */
async function pruneScans(client, days) {
  const { rowCount } = await client.query(
    "DELETE FROM signature_scan WHERE scanned_at < now() - ($1::int * interval '1 day')",
    [days],
  );
  return rowCount;
}

/** Aggregates for the vault stats card. One round-trip, not five. */
async function stats(client) {
  const { rows } = await client.query(`
    SELECT count(*)::int                                            AS total,
           count(*) FILTER (WHERE revoked_at IS NOT NULL)::int       AS revoked,
           count(*) FILTER (WHERE party = 'INTERNAL')::int           AS internal,
           count(*) FILTER (WHERE party = 'EXTERNAL')::int           AS external,
           count(*) FILTER (WHERE signed_at > now() - interval '30 days')::int AS last_30d
      FROM document_signature`);
  const { rows: byPreset } = await client.query(`
    SELECT COALESCE(preset_code, 'UNKNOWN') AS preset_code, count(*)::int AS n
      FROM document_signature GROUP BY 1 ORDER BY 2 DESC`);
  const { rows: byDocType } = await client.query(`
    SELECT doc_type, count(*)::int AS n
      FROM document_signature GROUP BY 1 ORDER BY 2 DESC`);
  /*
   * Stale count by doc type. Read off the OPEN compliance flags rather than by
   * recomputing every canonical hash: the flag is raised the first time a read
   * detects the amendment (document_signature.service.onAmendmentDetected), so
   * it is already the tenant's own record of "signatures that no longer cover
   * their document". Recomputing here would mean loading every signed record
   * in the tenant to render one card.
   *
   * entity_ref is `<doc_type lowercased>:<record id>`, so the type is the part
   * before the first colon — upper-cased back to the doc_type vocabulary.
   */
  const { rows: stale } = await client.query(`
    SELECT upper(split_part(entity_ref, ':', 1)) AS doc_type, count(*)::int AS n
      FROM compliance_flag
     WHERE rule_key = 'signature.amended_after_signing' AND resolved_at IS NULL
     GROUP BY 1 ORDER BY 2 DESC`);
  const { rows: scans } = await client.query(`
    SELECT count(*)::int AS scans_30d,
           count(*) FILTER (WHERE is_new_ip)::int AS new_ip_scans_30d
      FROM signature_scan WHERE scanned_at > now() - interval '30 days'`);
  return { ...rows[0], ...scans[0], by_preset: byPreset, by_doc_type: byDocType, stale_by_doc_type: stale };
}

module.exports = {
  insert, getById, getByVerifyCode, listByRef, countActive, revoke, setArtifact,
  lockForAmendment, amendmentFlagExists, raiseAmendmentFlag, stats,
  scanSeenFromIp, insertScan, countScansInWindow, listScans, scanSummary, pruneScans,
};
