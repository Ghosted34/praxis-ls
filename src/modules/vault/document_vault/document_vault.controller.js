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
function fileMeta(doc) {
  const pathExt = path.extname(String(doc.storage_path || "")).slice(1).toLowerCase();
  const contentType = MIME_BY_EXT[pathExt] || "application/octet-stream";
  const extension = EXT_BY_MIME[contentType] || pathExt || "bin";
  const stem = String(doc.doc_type || "document").replace(/[^A-Za-z0-9_-]+/g, "_");
  return { contentType, extension, filename: `${stem}-${doc.doc_id}.${extension}` };
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
