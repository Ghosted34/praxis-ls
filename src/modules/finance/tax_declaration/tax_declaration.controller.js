"use strict";
const service = require("./tax_declaration.service");
const { asyncHandler } = require("../../../utils/errors");
const filters = (req) => { const q = req.validatedQuery || {}; return { entityId: q.entity_id, from: q.from, to: q.to }; };
module.exports = {
  vatReturn: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.vatReturn(c, filters(req))) })),
  corporateTax: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.corporateTax(c, filters(req))) })),
  withholdingReturn: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.withholdingReturn(c, filters(req))) })),
  dsfDataset: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.dsfDataset(c, filters(req))) })),
  cnpsDeclaration: asyncHandler(async (req, res) => {
    const q = req.validatedQuery || {};
    return res.json({ data: await req.tenantDb((c) => service.cnpsDeclaration(c, { entityId: q.entity_id, periodCode: q.period_code })) });
  }),
};
