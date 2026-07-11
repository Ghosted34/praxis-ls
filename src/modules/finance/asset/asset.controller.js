/** Asset (MOD-54) HTTP handlers — thin: req.tenantDb → service. */
"use strict";
const service = require("./asset.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Asset not found", 404);
    res.json({ data: r });
  }),
  create: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.create(c, { data: req.body, actor: actor(req) })) })),
  update: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),
  depreciate: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.depreciate(c, { id: req.params.id, period_code: req.body.period_code, actor: actor(req) })) })),
  dispose: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.dispose(c, { id: req.params.id, disposed_on: req.body.disposed_on, proceeds: req.body.proceeds || 0, actor: actor(req) })) })),
};
