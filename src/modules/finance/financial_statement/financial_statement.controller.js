"use strict";
const service = require("./financial_statement.service");
const { asyncHandler } = require("../../../utils/errors");
const filters = (req) => {
  const q = req.validatedQuery || {};
  return { entityId: q.entity_id, periodId: q.period_id, from: q.from, to: q.to };
};
module.exports = {
  trialBalance: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.trialBalance(c, filters(req))) })),
  compteDeResultat: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.compteDeResultat(c, filters(req))) })),
  bilan: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.bilan(c, filters(req))) })),
  grandLivre: asyncHandler(async (req, res) => { const q = req.validatedQuery || {}; return res.json({ data: await req.tenantDb((c) => service.grandLivre(c, { accountCode: q.account, entityId: q.entity_id, from: q.from, to: q.to })) }); }),
  cashFlow: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.cashFlow(c, filters(req))) })),
};
