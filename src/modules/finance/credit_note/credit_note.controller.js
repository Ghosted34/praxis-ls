"use strict";
const service = require("./credit_note.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Credit note not found", 404);
    res.json({ data: r });
  }),
  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.createDraft(c, { entityId: b.entity_id, clientId: b.client_id, dossierId: b.dossier_id, reversesInvoiceId: b.reverses_invoice_id, lines: b.lines, actor: actor(req) }));
    res.status(201).json({ data });
  }),
  update: asyncHandler(async (req, res) => {
    const b = req.body;
    res.json({ data: await req.tenantDb((c) => service.updateDraft(c, { creditNoteId: req.params.id, patch: b, lines: b.lines || null, actor: actor(req) })) });
  }),
  post: asyncHandler(async (req, res) => {
    const b = req.body || {};
    res.json({ data: await req.tenantDb((c) => service.post(c, { creditNoteId: req.params.id, entryDate: b.entry_date, sourceDocRef: b.source_doc_ref, actor: actor(req) })) });
  }),
};
