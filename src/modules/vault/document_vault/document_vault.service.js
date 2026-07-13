/**
 * Document vault (MOD-64). Capture a document ONCE per entity_ref then keep it in
 * sync; serve bytes for the auth-gated download. SQL lives in the repo.
 */
"use strict";
const crypto = require("crypto");
const repo = require("./document_vault.repo");
const events = require("./document_vault.events");
const storage = require("../../../services/storage.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const EXT = {
  "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
  "image/webp": "webp", "text/plain": "txt", "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};
const MAX_BYTES = 25 * 1024 * 1024;

async function capture(client, opts) {
  const {
    entityRef, docType = null, storagePath = null, contentHash = null,
    fileContext = null, folderRef = null, dossierId = null, status = null,
  } = opts;
  if (!entityRef) throw new AppError("NO_ENTITY_REF", "entityRef is required", 422);
  const path = storagePath || "pending://" + entityRef;
  const existing = await repo.getByRef(client, entityRef);
  if (existing) return repo.updateSync(client, existing.doc_id, { storagePath: path, contentHash, docType, status });
  return repo.insert(client, {
    entity_ref: entityRef, doc_type: docType, storage_path: path, content_hash: contentHash,
    file_context: fileContext, folder_ref: folderRef, dossier_id: dossierId, ...(status ? { status } : {}),
  });
}

async function fetchBytes(client, docId) {
  const doc = await repo.get(client, docId);
  if (!doc) throw new AppError("NOT_FOUND", "Document not found", 404);
  if (!doc.storage_path || doc.storage_path.startsWith("pending://")) {
    throw new AppError("NOT_READY", "Document not rendered yet", 409);
  }
  const buffer = await storage.get(doc.storage_path);
  return { doc, buffer };
}

const getByRef = (client, ref) => repo.getByRef(client, ref);
const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);

/**
 * Upload a document (base64 data URL) into the vault: store the bytes, record
 * the SHA-256 DNA and storage path. Unlike capture() (create-once by
 * entity_ref for system-generated docs), this inserts a standalone row so
 * ad-hoc uploads can coexist. Status VERIFIED since real bytes + hash exist.
 */
async function createDocument(client, opts) {
  const { entityRef = null, docType = null, dataUrl, fileContext = null, folderRef = null, dossierId = null, slug, actor = {} } = opts;
  const m = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl || ""));
  if (!m) throw new AppError("BAD_FILE", "Expected a base64 data URL", 400);
  const contentType = m[1].toLowerCase();
  const ext = EXT[contentType] || "bin";
  const buffer = Buffer.from(m[2], "base64");
  if (!buffer.length) throw new AppError("EMPTY_FILE", "File is empty", 422);
  if (buffer.length > MAX_BYTES) throw new AppError("FILE_TOO_LARGE", "File exceeds 25 MB", 413);
  const contentHash = crypto.createHash("sha256").update(buffer).digest("hex");
  const key = `tenant_${slug}/vault/doc_${crypto.randomBytes(8).toString("hex")}.${ext}`;
  await storage.put(buffer, { key, contentType });
  const row = await repo.insert(client, {
    entity_ref: entityRef, doc_type: docType, storage_path: key, content_hash: contentHash,
    file_context: fileContext, folder_ref: folderRef, dossier_id: dossierId, status: "VERIFIED",
  });
  await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: "document_vault:" + row.doc_id, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: "document_vault:" + row.doc_id, after: { doc_id: row.doc_id, doc_type: row.doc_type, content_hash: contentHash } });
  return row;
}

/** Soft-delete (archive) — vault evidence is retained; status flips to ARCHIVED. */
async function archiveDocument(client, { id, actor = {} }) {
  const doc = await repo.get(client, id);
  if (!doc) throw new AppError("NOT_FOUND", "Document not found", 404);
  const row = await repo.archive(client, id);
  await audit(client, { actorUserId: actor.user_id || null, action: events.ARCHIVED, moduleKey: events.MODULE, entityRef: "document_vault:" + id, before: doc, after: row });
  return row;
}

module.exports = { capture, fetchBytes, getByRef, get, list, createDocument, archiveDocument };
