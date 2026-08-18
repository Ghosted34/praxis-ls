"use strict";
const service = require("./extra_charge_simulation.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Simulation not found", 404);
    res.json({ data: row });
  }),
  rates: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.rates(c)) })),
  preview: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.preview(c, req.body)) })),
  create: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.create(c, req.body, actor(req))) })),
};
