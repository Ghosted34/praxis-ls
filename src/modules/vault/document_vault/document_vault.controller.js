"use strict";
const service = require("./document_vault.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Document not found", 404);
    res.json({ data: r });
  }),
  download: asyncHandler(async (req, res) => {
    const { doc, buffer } = await req.tenantDb((c) => service.fetchBytes(c, req.params.id));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=\"" + (doc.doc_type || "document") + "-" + doc.doc_id + ".pdf\"");
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
