"use strict";
const service = require("./goods_received.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { enqueueDocument } = require("../../../services/documents/generate");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "GRN not found", 404);
    res.json({ data: row });
  }),
  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.record(c, {
      poId: b.po_id, receivedBy: b.received_by, supplierInvoiceRef: b.supplier_invoice_ref,
      entityId: b.entity_id, date: b.date, lines: b.lines || [], note: b.note, actor: actor(req),
    }));
    // The GRN is a document the moment it is recorded — mint its PDF.
    if (data && data.grn_id) {
      enqueueDocument({ tenantMeta: req.tenant, env: req.env, docType: "GOODS_RECEIVED", recordId: data.grn_id });
    }
    res.status(201).json({ data });
  }),
  sendToWarehouse: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.sendToWarehouse(c, { id: req.params.id, actor: actor(req) }));
    res.json({ data });
  }),
};
