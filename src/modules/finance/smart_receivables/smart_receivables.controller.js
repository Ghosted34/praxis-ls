"use strict";
const service = require("./smart_receivables.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Receipt not found", 404);
    res.json({ data: row });
  }),
  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.createDraft(c, {
      clientId: b.client_id, method: b.method, treasuryAccountId: b.treasury_account_id, amount: b.amount, receivedOn: b.received_on, actor: actor(req),
    }));
    res.status(201).json({ data });
  }),
  post: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.post(c, {
      receiptId: req.params.id, entityId: b.entity_id, entryDate: b.entry_date, sourceDocRef: b.source_doc_ref, customerAccount: b.customer_account, actor: actor(req), ip: req.ip,
    }));
    res.json({ data });
  }),
  ageing: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.ageing(c, { clientId: req.query.client_id, asOf: req.query.as_of })) })),
  overdue: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.overdue(c, { clientId: req.query.client_id, asOf: req.query.as_of })) })),
  reminders: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.reminders(c, { asOf: req.query.as_of })) })),
};
