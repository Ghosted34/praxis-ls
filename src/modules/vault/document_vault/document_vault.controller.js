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
    const data = await req.tenantDb((c) => service.createDocument(c, {
      entityRef: b.entity_ref, docType: b.doc_type, dataUrl: b.data_url,
      fileContext: b.file_context, folderRef: b.folder_ref, dossierId: b.dossier_id,
      slug: req.tenant.slug, actor: req.user || { user_id: null },
    }));
    res.status(201).json({ data });
  }),
  archive: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.archiveDocument(c, { id: req.params.id, actor: req.user || { user_id: null } })) })),
};
