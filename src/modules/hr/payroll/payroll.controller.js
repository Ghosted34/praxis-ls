/** Payroll (MOD-17) HTTP handlers — thin: req.tenantDb → service. */
"use strict";
const service = require("./payroll.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Payroll run not found", 404);
    res.json({ data: r });
  }),
  create: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.createRun(c, { data: req.body, actor: actor(req) })) })),
  compute: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.compute(c, { id: req.params.id, config: req.body?.config || null, actor: actor(req) })) })),
  setStatus: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.setStatus(c, { id: req.params.id, status: req.body.status, actor: actor(req) })) })),
};
