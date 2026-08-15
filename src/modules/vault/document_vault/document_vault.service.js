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
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { parseDataUrl } = require("../../../utils/data-url");

const EXT = {
  "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
  "image/webp": "webp", "text/plain": "txt", "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * What the FILE says it is, read from its first bytes.
 *
 * WHY, when the data URL already declares a type. Because the declaration is
 * the uploader's, and the uploader is a browser relaying whatever the operating
 * system guessed from the extension. Legacy sniffed content for exactly this
 * reason (`upload.php:98-105`), and renaming `payload.exe` to `invoice.pdf` is
 * the oldest trick there is. The declared type decides the STORED extension; the
 * sniff decides whether it is stored at all.
 *
 * Deliberately small: the four magic numbers that matter for the formats an
 * operations file accepts. Anything else returns null and is refused by the
 * caller that asked for sniffing, rather than being guessed at.
 */
function sniffContentType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  // %PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return "application/pdf";
  // \x89PNG\r\n\x1a\n
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  // JPEG SOI + marker
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  // RIFF....WEBP
  if (buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

// Mirrors the document_vault.status CHECK constraint (migration 0340). Guarding
// here turns a wrong status into a clean 422 instead of a raw 23514 from Postgres
// (which is how issuers passing "DRAFT" used to surface).
const VALID_STATUS = new Set(["PENDING", "VERIFIED", "REJECTED", "ARCHIVED"]);

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
  if (effStatus !== null && effStatus !== undefined && !VALID_STATUS.has(effStatus)) {
    throw new AppError("BAD_STATUS", "document status must be one of " + [...VALID_STATUS].join(", "), 422);
  }

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
  const {
    entityRef = null, docType = null, dataUrl, fileContext = null, folderRef = null,
    dossierId = null, docTypeRefId = null, clientId = null, originalName = null,
    // Stricter rules for one caller, rather than tightened for all. An
    // operations file accepts what legacy accepted — 5 MB, PDF/PNG/JPG, content
    // sniffed — while the HR and finance paths keep the 25 MB and the wider
    // type list they already had. Narrowing those here would be a silent
    // regression in modules this change has no business touching.
    maxBytes = MAX_BYTES, allowedTypes = null, sniff = false,
    slug, actor = {},
  } = opts;
  // Ad-hoc uploads are free-form (scanned contracts, IDs, …) — no registry guard
  // here; the doc_type registry constrains system-generated captures, not uploads.
  // Parameters are legal in a data URL's media type (`;codecs=`, `;charset=`)
  // and the pattern this replaced could not cross them — see utils/data-url.
  // `mimeType` is the bare type, which is what `allowedTypes` compares against.
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new AppError("BAD_FILE", "Expected a base64 data URL", 400);
  const contentType = parsed.mimeType;
  const buffer = parsed.buffer;
  if (!buffer.length) throw new AppError("EMPTY_FILE", "File is empty", 422);
  if (buffer.length > maxBytes) {
    throw new AppError("FILE_TOO_LARGE", `File exceeds ${Math.round(maxBytes / (1024 * 1024))} MB`, 413);
  }
  if (allowedTypes && !allowedTypes.includes(contentType)) {
    throw new AppError("BAD_FILE_TYPE", `Only ${allowedTypes.join(", ")} are accepted here`, 422);
  }
  // The declared type chooses the extension; the sniffed one decides whether the
  // bytes are stored at all. A .exe renamed .pdf declares application/pdf and
  // sniffs as nothing.
  if (sniff) {
    const actual = sniffContentType(buffer);
    if (!actual) throw new AppError("BAD_FILE_TYPE", "This file is not a PDF or an image", 422);
    if (allowedTypes && !allowedTypes.includes(actual)) {
      throw new AppError("BAD_FILE_TYPE", `Only ${allowedTypes.join(", ")} are accepted here`, 422);
    }
    // Declared JPEG, actually PNG is harmless mislabelling; declared PDF,
    // actually anything else is not. Refuse the mismatch either way and let the
    // person re-export rather than storing bytes under the wrong name.
    if (actual !== contentType && !(actual === "image/jpeg" && contentType === "image/jpg")) {
      throw new AppError("BAD_FILE_TYPE", `This file says it is ${contentType} but its contents are ${actual}`, 422);
    }
  }
  const ext = EXT[contentType] || "bin";
  const contentHash = crypto.createHash("sha256").update(buffer).digest("hex");
  const key = `tenant_${slug}/vault/doc_${crypto.randomBytes(8).toString("hex")}.${ext}`;
  await storage.put(buffer, { key, contentType });
  const row = await repo.insert(client, {
    entity_ref: entityRef, doc_type: docType, storage_path: key, content_hash: contentHash,
    file_context: fileContext, folder_ref: folderRef, dossier_id: dossierId, status: "VERIFIED",
    // 0669: the typed filing. `doc_type` (text) stays populated from the
    // registry code so every existing reader keeps working.
    doc_type_ref_id: docTypeRefId, client_id: clientId,
    original_name: originalName,
    // Through `resolveActorId`, not `actor.user_id` (DATA 2.4). `uploaded_by`
    // REFERENCES app_user, but identity lives in the LIVE schema while this
    // write can land in SANDBOX — where that user does not exist and Postgres
    // answers 23503, failing the whole upload. Losing an attribution is a much
    // smaller harm than losing the document, so it resolves to NULL instead.
    uploaded_by: await resolveActorId(client, actor.user_id),
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
