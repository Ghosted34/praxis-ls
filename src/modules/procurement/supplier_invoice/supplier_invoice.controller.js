"use strict";
const service = require("./supplier_invoice.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { enqueueDocument } = require("../../../services/documents/generate");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Supplier invoice not found", 404);
    res.json({ data: row });
  }),
  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.createDraft(c, {
      entityId: b.entity_id, supplierId: b.supplier_id, poId: b.po_id, grnId: b.grn_id, dossierId: b.dossier_id,
      supplierRef: b.supplier_ref, currency: b.currency, vatTotal: b.vat_total, whtTotal: b.wht_total, dueOn: b.due_on, lines: b.lines || [], actor: actor(req),
    }));
    res.status(201).json({ data });
  }),
  match: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.match(c, { supplierInvoiceId: req.params.id, actor: actor(req) })) })),
  post: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.post(c, { supplierInvoiceId: req.params.id, entryDate: b.entry_date, sourceDocRef: b.source_doc_ref, supplierAccount: b.supplier_account, actor: actor(req), ip: req.ip }));
    // Auto-generate the supplier-invoice PDF when it hits the ledger.
    if (data && data.supplier_invoice && data.supplier_invoice.status === "POSTED_LOCKED") {
      enqueueDocument({ tenantMeta: req.tenant, env: req.env, docType: "SUPPLIER_INVOICE", recordId: req.params.id });
    }
    res.json({ data });
  }),
  pay: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.pay(c, {
      supplierInvoiceId: req.params.id, amount: b.amount, entityId: b.entity_id, entryDate: b.entry_date,
      treasuryAccountId: b.treasury_account_id, treasuryCoa: b.treasury_coa, note: b.note, actor: actor(req), ip: req.ip,
    }));
    res.json({ data });
  }),
  reverse: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.reverse(c, { supplierInvoiceId: req.params.id, reason: b.reason, entryDate: b.entry_date, actor: actor(req), ip: req.ip }));
    res.json({ data });
  }),
};
