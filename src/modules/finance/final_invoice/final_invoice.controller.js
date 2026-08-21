"use strict";
const service = require("./final_invoice.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { enqueueDocument } = require("../../../services/documents/generate");
const { sendPaged } = require("../../../shared/http/paged");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) =>
    sendPaged(res, await req.tenantDb((c) => service.listPaged(c, req.query)))),
  get: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Invoice not found", 404);
    res.json({ data: row });
  }),
  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.createDraft(c, {
      entityId: b.entity_id, clientId: b.client_id, dossierId: b.dossier_id, lines: b.lines || [],
      pricingOverride: b.pricing_override || null, actor: actor(req),
    }));
    res.status(201).json({ data });
  }),
  update: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.updateDraft(c, {
      invoiceId: req.params.id, patch: { client_id: b.client_id, dossier_id: b.dossier_id }, lines: b.lines || null,
      pricingOverride: b.pricing_override || null, actor: actor(req),
    }));
    res.json({ data });
  }),
  totals: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.previewTotals(c, { invoiceId: req.params.id, entryDate: req.query.entry_date })) })),
  submit: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.submit(c, {
      invoiceId: req.params.id, entryDate: b.entry_date, sourceDocRef: b.source_doc_ref, actor: actor(req), ip: req.ip,
    }));
    // On the issue transition, auto-render the branded invoice PDF into the vault
    // (fire-and-forget; the other captured docTypes wire the same one line).
    if (data && data.status === "ISSUED_LOCKED") {
      enqueueDocument({ tenantMeta: req.tenant, env: req.env, docType: "FINAL_INVOICE", recordId: req.params.id });
    }
    res.json({ data });
  }),
};
