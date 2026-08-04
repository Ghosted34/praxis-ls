"use strict";
const service = require("./proforma.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { sendPaged } = require("../../../shared/http/paged");
module.exports = {
  list: asyncHandler(async (req, res) =>
    sendPaged(res, await req.tenantDb((c) => service.listPaged(c, req.query)))),
  get: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Advance not found", 404);
    res.json({ data: row });
  }),
  pay: asyncHandler(async (req, res) => {
    const b = req.body;
    const result = await req.tenantDb((c) => service.recordPayment(c, {
      entityId: b.entity_id, clientId: b.client_id, dossierId: b.dossier_id,
      amount: b.amount, treasuryCoa: b.treasury_coa, entryDate: b.entry_date,
      sourceDocRef: b.source_doc_ref, actor: req.user || { user_id: null }, ip: req.ip,
    }));
    res.status(201).json({ data: result });
  }),
};
