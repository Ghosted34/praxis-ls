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
  return { ...rows[0], by_preset: byPreset };
}

module.exports = {
  insert, getById, getByVerifyCode, listByRef, countActive, revoke, setArtifact,
  lockForAmendment, amendmentFlagExists, raiseAmendmentFlag, stats,
};
