"use strict";
const service = require("./office_expense.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  totals: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.totals(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Office expense not found", 404);
    res.json({ data: r });
  }),
  create: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.create(c, { data: req.body, actor: actor(req) }));
    res.status(201).json({ data });
  }),
  update: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),
  post: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.post(c, { id: req.params.id, entryDate: b.entry_date, paidVia: b.paid_via, creditCoa: b.credit_coa, sourceDocRef: b.source_doc_ref, actor: actor(req), ip: req.ip }));
    res.json({ data });
  }),
  remove: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.remove(c, { id: req.params.id, actor: actor(req) })) })),
};
