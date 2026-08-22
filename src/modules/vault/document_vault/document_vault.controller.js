"use strict";
const path = require("path");
const service = require("./document_vault.service");
const { asyncHandler, AppError } = require("../../../utils/errors");

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
const EXT_BY_MIME = Object.fromEntries(Object.entries(MIME_BY_EXT).map(([ext, mime]) => [mime, ext === "jpeg" ? "jpg" : ext]));

/**
 * Uploaded scans are not all PDFs. Vault rows keep the extension selected by
 * the upload service in their storage key, so derive a safe response type from
 * it. This prevents a PNG or JPEG from being sent to the browser as
 * `application/pdf`.
 */
/**
 * A FILENAME SOMEONE CAN FILE.
 *
 * This used to be `${doc_type}-${doc_id}.pdf`, so every download landed in the
 * user's folder as `EMPLOYMENT_CONTRACT-3fa85f64-5717-4562-b3fc-2c963f66afa6.pdf`
 * — a UUID no human recognises, on a document that HAS a reference printed
 * inside it. Two of those in a downloads folder are indistinguishable without
 * opening both.
 *
 * Order of preference, most meaningful first:
 *   1. `doc_number` — the allocated reference. NOT YET carried onto the vault
 *      row for generated documents; read here so the day `capture()` passes it
 *      through, every filename improves with no further change.
 *   2. `original_name` — what an UPLOADED file was called. A scan the user
 *      named "Passport Amina.pdf" should come back as that, not as a UUID.
 *   3. the id fragment — last resort, 8 characters.
 *
 * Never the full UUID. The doc type is title-cased and its underscores opened
 * out, because the type is the first thing a person scans for.
 *
 * `safe()` is not cosmetic: this value goes into a `Content-Disposition`
 * header, so a quote or a newline in a stored title could otherwise forge
 * header structure. Anything outside the allow-list becomes a space, runs are
 * collapsed, and the result is length-capped.
 */
function safe(part) {
  return String(part || "")
    .replace(/[^A-Za-z0-9 ._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function fileMeta(doc) {
  const pathExt = path.extname(String(doc.storage_path || "")).slice(1).toLowerCase();
  const contentType = MIME_BY_EXT[pathExt] || "application/octet-stream";
  const extension = EXT_BY_MIME[contentType] || pathExt || "bin";
  const typeWords = safe(String(doc.doc_type || "document").replace(/_/g, " "));
  const stem = typeWords ? typeWords.charAt(0).toUpperCase() + typeWords.slice(1).toLowerCase() : "Document";
  const uploaded = doc.original_name ? String(doc.original_name).replace(/\.[A-Za-z0-9]{1,8}$/, "") : null;
  const ref = safe(doc.doc_number || uploaded || String(doc.doc_id || "").slice(0, 8));
  const filename = `${[stem, ref].filter(Boolean).join(" ")}.${extension}`.replace(/\s+/g, " ");
  return { contentType, extension, filename };
}

module.exports = {
  fileMeta,
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Document not found", 404);
    res.json({ data: r });
  }),
  download: asyncHandler(async (req, res) => {
    const { doc, buffer } = await req.tenantDb((c) => service.fetchBytes(c, req.params.id));
    const meta = fileMeta(doc);
    res.setHeader("Content-Type", meta.contentType);
    res.setHeader("Content-Disposition", `inline; filename="${meta.filename}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(buffer);
  }),
  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb(async (c) => {
      // A registry reference decides the stored `doc_type` text, so the two can
      // never drift. A caller that sends only the free-text type still works —
      // that is every pre-0669 caller.
      let docType = b.doc_type || null;
      if (b.doc_type_ref_id) {
        const { rows } = await c.query(
          "SELECT code FROM dictionary_ref WHERE ref_id = $1 AND kind = 'DOCUMENT_TYPE'",
          [b.doc_type_ref_id],
        );
        if (!rows[0]) throw new AppError("UNKNOWN_DOC_TYPE", "That document type is not in the registry", 422);
        docType = rows[0].code;
      }
      return service.createDocument(c, {
        entityRef: b.entity_ref, docType, dataUrl: b.data_url,
        fileContext: b.file_context, folderRef: b.folder_ref, dossierId: b.dossier_id,
        docTypeRefId: b.doc_type_ref_id || null, clientId: b.client_id || null,
        originalName: b.original_name || null,
        // An upload attached to an operations file follows legacy's rules —
        // 5 MB, PDF/PNG/JPG, contents checked. Uploads elsewhere (HR files,
        // finance scans) keep the vault's wider defaults untouched.
        ...(b.dossier_id
          ? { maxBytes: 5 * 1024 * 1024, allowedTypes: ["application/pdf", "image/png", "image/jpeg", "image/jpg"], sniff: true }
          : {}),
        slug: req.tenant.slug, actor: req.user || { user_id: null },
      });
    });
    res.status(201).json({ data });
  }),
  archive: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.archiveDocument(c, { id: req.params.id, actor: req.user || { user_id: null } })) })),
};
