/**
 * Document vault repository (MOD-64). All SQL for document_vault lives here
 * (CONVENTIONS: the repo is the only place with SQL). Capture is create-once by
 * entity_ref, then update-in-sync (version_no bumps) — see BUILD_CONVENTIONS §3.
 */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

async function getByRef(client, entityRef) {
  const { rows } = await client.query(
    "SELECT * FROM document_vault WHERE entity_ref = $1 ORDER BY created_at ASC LIMIT 1",
    [entityRef],
  );
  return rows[0] || null;
}

function insert(client, data) {
  return insertOne(client, "document_vault", data);
}

async function updateSync(client, docId, { storagePath, contentHash, docType, status }) {
  const { rows } = await client.query(
    "UPDATE document_vault SET storage_path = $2, content_hash = COALESCE($3, content_hash), " +
      "doc_type = COALESCE($4, doc_type), status = COALESCE($5, status), " +
      "version_no = version_no + 1, updated_at = now() WHERE doc_id = $1 RETURNING *",
    [docId, storagePath, contentHash, docType, status],
  );
  return rows[0];
}

const get = (client, id) => getById(client, "document_vault", "doc_id", id);

async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.entity_ref) { params.push(q.entity_ref); wh.push("entity_ref = $" + params.length); }
  if (q.doc_type) { params.push(q.doc_type); wh.push("doc_type = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    "SELECT * FROM document_vault " + where + " ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return rows;
}

/** Soft-delete: the vault is compliance evidence, so we archive rather than
 *  hard-delete (keeps content_hash + storage_path for later audit). */
async function archive(client, id) {
  const { rows } = await client.query(
    "UPDATE document_vault SET status = 'ARCHIVED', updated_at = now() WHERE doc_id = $1 RETURNING *", [id]);
  return rows[0] || null;
}

module.exports = { getByRef, insert, updateSync, get, list, archive };
