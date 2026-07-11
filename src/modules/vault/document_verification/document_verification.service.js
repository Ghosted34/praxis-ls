/**
 * Document verification (MOD-66) — the resolve-and-recheck behind the QR token
 * (praxis://verify/<entity_ref>?h=<hash16>). Given a doc_id or entity_ref + hash,
 * confirm the stored content_hash matches (tamper check). Read-only; SQL via the
 * document_vault repo.
 */
"use strict";
const vaultRepo = require("../document_vault/document_vault.repo");
const { AppError } = require("../../../utils/errors");

async function verify(client, { docId = null, entityRef = null, hash }) {
  if (!hash) throw new AppError("NO_HASH", "hash is required", 422);
  let doc = null;
  if (docId) doc = await vaultRepo.get(client, docId);
  else if (entityRef) doc = await vaultRepo.getByRef(client, entityRef);
  else throw new AppError("NO_TARGET", "doc_id or entity_ref is required", 422);
  if (!doc) throw new AppError("NOT_FOUND", "Document not found", 404);
  const stored = doc.content_hash || "";
  const match = Boolean(stored) && (stored === hash || stored.startsWith(hash));
  return {
    verified: match,
    doc_id: doc.doc_id,
    entity_ref: doc.entity_ref,
    doc_type: doc.doc_type,
    version_no: doc.version_no,
    content_hash: stored,
  };
}

/** Public QR scan — minimal tamper verdict, no confidential internals. */
async function scan(client, { docId = null, entityRef = null, hash }) {
  const r = await verify(client, { docId, entityRef, hash });
  return { verified: r.verified, doc_type: r.doc_type, version_no: r.version_no };
}

module.exports = { verify, scan };
