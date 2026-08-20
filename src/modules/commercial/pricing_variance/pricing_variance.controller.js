"use strict";
const service = require("./pricing_variance.service");
const { asyncHandler } = require("../../../utils/errors");
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listSales(c, req.query)) })),
  get: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.getSales(c, req.params.id)) })),
  finance: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.getFinance(c, req.params.id)) })),
};
