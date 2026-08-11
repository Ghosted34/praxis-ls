"use strict";
const service = require("./expense_rate.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.get(c, req.params.id)); if (!r) throw new AppError("NOT_FOUND", "Expense rate not found", 404); res.json({ data: r }); }),
  resolve: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((c) => service.resolve(c, {
      dictionaryItemId: req.query.dictionary_item_id,
      date: req.query.date,
      rateProviderId: req.query.rate_provider_id,
      containerTypeRefId: req.query.container_type_ref_id,
    })),
  })),
  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.create(c, {
      dictionaryItemId: b.dictionary_item_id,
      rateProviderId: b.rate_provider_id,
      containerTypeRefId: b.container_type_ref_id,
      rate: b.rate, currency: b.currency,
      effectiveFrom: b.effective_from, effectiveTo: b.effective_to,
      note: b.note,
      actor: actor(req),
    }));
    res.status(201).json({ data });
  }),
  update: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),
  remove: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.remove(c, { id: req.params.id, actor: actor(req) })) })),
};
