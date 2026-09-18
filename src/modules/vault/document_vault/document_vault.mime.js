/**
 * What a stored vault document IS, derived from the extension the upload
 * service chose for its storage key.
 *
 * ── WHY THIS IS ITS OWN FILE ────────────────────────────────────────────────
 *
 * This table used to live inside `document_vault.controller.js`, which is fine
 * for the two routes that file owns and useless to everybody else: a controller
 * is the one thing a service must not require (`document_vault.controller`
 * requires `document_vault.service`, so the reverse edge is a cycle). So the
 * second consumer — the public secure-link route, which serves the very same
 * bytes to a counterparty — could not reach it and invented its own answer:
 *
 *     content_type: doc.content_type || "application/octet-stream"
 *
 * `document_vault` HAS NO `content_type` COLUMN. Migration 0340 creates the
 * table without one, 0669 adds `original_name`/`client_id`/`doc_type_ref_id`,
 * and 10702 adds only the `public_media_*` set. So that expression is not a
 * fallback that rarely fires — the left side is `undefined` on every row in the
 * product, and every document ever fetched through a secure link has been
 * described to its recipient as `application/octet-stream`.
 *
 * The single source of truth is therefore here, and both callers read it.
 *
 * ── THE ALLOW-LIST IS THE SECURITY BOUNDARY ─────────────────────────────────
 *
 * This map is also what stops the vault serving active content from the app's
 * own origin. There is deliberately no `html`, `htm`, `svg`, `xml` or `js`
 * entry: anything not listed becomes `application/octet-stream`, which no
 * browser will execute or render in place. Preview code — internal or public —
 * decides what to DISPLAY from the type this returns, so widening this map
 * silently widens what a preview will frame. Add a row only with that in mind.
 */
"use strict";

const path = require("path");

const MIME_BY_EXT = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  txt: "text/plain",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const EXT_BY_MIME = Object.fromEntries(
  Object.entries(MIME_BY_EXT).map(([ext, mime]) => [mime, ext === "jpeg" ? "jpg" : ext]),
);

/** The default for anything unrecognised: inert, and never rendered in place. */
const FALLBACK_TYPE = "application/octet-stream";

/**
 * The content type for a stored document, from its storage key's extension.
 *
 * The extension is the upload service's own choice (`EXT[storedType]` in
 * `createDocument`), not anything a caller supplied, which is why it is
 * trustworthy here and why the declared upload type is not consulted.
 */
function contentTypeForPath(storagePath) {
  const ext = path.extname(String(storagePath || "")).slice(1).toLowerCase();
  return MIME_BY_EXT[ext] || FALLBACK_TYPE;
}

module.exports = { MIME_BY_EXT, EXT_BY_MIME, FALLBACK_TYPE, contentTypeForPath };
