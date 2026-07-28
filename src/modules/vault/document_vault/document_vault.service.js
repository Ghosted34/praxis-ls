/**
 * Document vault (MOD-64). Capture a document ONCE per entity_ref then keep it in
 * sync; serve bytes for the auth-gated download. SQL lives in the repo.
 */
"use strict";
const crypto = require("crypto");
const repo = require("./document_vault.repo");
const events = require("./document_vault.events");
const { assertDocType } = require("./document_vault.types");
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

/** True once a real stored object backs the row (not the pending placeholder). */
const hasBytes = (storagePath) => Boolean(storagePath) && !String(storagePath).startsWith("pending://");

/**
 * A document may only be VERIFIED once real bytes exist — otherwise the row
 * contradicts fetchBytes()'s NOT_READY-if-pending guard. A placeholder capture
 * (issuer records the doc before it is rendered) stays PENDING until
 * renderAndStore supplies the stored path (GAP_FIXES_PLAN §5.3).
 */
const resolveStatus = (status, storagePath) =>
  (status === "VERIFIED" && !hasBytes(storagePath) ? "PENDING" : status);

async function capture(client, opts) {
  const {
    entityRef, docType = null, storagePath = null, contentHash = null,
    fileContext = null, folderRef = null, dossierId = null, status = null, actor = {},
  } = opts;
  if (!entityRef) throw new AppError("NO_ENTITY_REF", "entityRef is required", 422);
  assertDocType(docType);
  const path = storagePath || "pending://" + entityRef;
  const effStatus = resolveStatus(status, storagePath);

  // Update-in-sync: system docs are captured once per entity_ref, then bumped
  // (e.g. placeholder → rendered bytes). Emit UPDATED + audit the transition.
  const existing = await repo.getByRef(client, entityRef);
  if (existing) {
    const row = await repo.updateSync(client, existing.doc_id, { storagePath: path, contentHash, docType, status: effStatus });
    await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: "document_vault:" + existing.doc_id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: "document_vault:" + existing.doc_id, before: existing, after: row });
    return row;
  }

  // First capture — emit CREATED + audit so system-generated docs get the same
  // trail that ad-hoc uploads (createDocument) already record.
  const row = await repo.insert(client, {
    entity_ref: entityRef, doc_type: docType, storage_path: path, content_hash: contentHash,
    file_context: fileContext, folder_ref: folderRef, dossier_id: dossierId, ...(effStatus ? { status: effStatus } : {}),
  });
  await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: "document_vault:" + row.doc_id, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: "document_vault:" + row.doc_id, after: row });
  return row;
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
  // Ad-hoc uploads are free-form (scanned contracts, IDs, …) — no registry guard
  // here; the doc_type registry constrains system-generated captures, not uploads.
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

module.exports = { capture, fetchBytes, getByRef, get, list, createDocument, archiveDocument, resolveStatus, hasBytes };
