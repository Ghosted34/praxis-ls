"use strict";
const service = require("./pricing_variance.service");
const { asyncHandler } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listSales(c, req.query)) })),
  get: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.getSales(c, req.params.id)) })),
  finance: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.getFinance(c, req.params.id)) })),
  compute: asyncHandler(async (req, res) => {
    const b = req.body;
    res.status(201).json({ data: await req.tenantDb((c) => service.compute(c, { dossierId: b.dossier_id, quotationId: b.quotation_id, costingId: b.costing_id, marginSimulationId: b.margin_simulation_id, quotedPrice: b.quoted_price, actualCost: b.actual_cost, actor: actor(req) })) });
  }),
};
