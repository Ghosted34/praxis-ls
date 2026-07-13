/**
 * Document-verification repository (MOD-66). Owns the read SQL this module needs
 * against document_vault — resolve a doc by doc_id or by entity_ref (earliest).
 * Keeps the module self-contained (its own repo) rather than reaching into the
 * vault module's repo.
 */
"use strict";

const COLS = "doc_id, entity_ref, doc_type, version_no, content_hash, status";

async function getDoc(client, { docId = null, entityRef = null }) {
  if (docId) {
    const { rows } = await client.query("SELECT " + COLS + " FROM document_vault WHERE doc_id = $1", [docId]);
    return rows[0] || null;
  }
  if (entityRef) {
    const { rows } = await client.query(
      "SELECT " + COLS + " FROM document_vault WHERE entity_ref = $1 ORDER BY created_at ASC LIMIT 1", [entityRef]);
    return rows[0] || null;
  }
  return null;
}

module.exports = { getDoc };
