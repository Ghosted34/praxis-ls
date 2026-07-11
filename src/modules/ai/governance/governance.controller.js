"use strict";
const service = require("./governance.service");
const { asyncHandler } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  listFeatures: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listFeatures(c)) })),
  setFeature: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.setFeature(c, { featureKey: req.params.key, patch: req.body, actor: actor(req) })) })),
  listGrants: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listGrants(c, { userId: req.query.user_id })) })),
  grant: asyncHandler(async (req, res) => { const b = req.body; res.status(201).json({ data: await req.tenantDb((c) => service.grantAccess(c, { userId: b.user_id, featureKey: b.feature_key, monthlyCapXaf: b.monthly_cap_xaf, actor: actor(req) })) }); }),
  revoke: asyncHandler(async (req, res) => { const b = req.body; res.json({ data: await req.tenantDb((c) => service.revokeAccess(c, { userId: b.user_id, featureKey: b.feature_key, reason: b.reason, actor: actor(req) })) }); }),
  budget: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.budgetStatus(c, { onDate: req.query.on_date })) })),
  setBudget: asyncHandler(async (req, res) => { const b = req.body; res.status(201).json({ data: await req.tenantDb((c) => service.setBudget(c, { periodStart: b.period_start, periodEnd: b.period_end, softCapXaf: b.soft_cap_xaf, hardCapXaf: b.hard_cap_xaf, actor: actor(req) })) }); }),
  canUse: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.canUseFeature(c, { userId: req.query.user_id || (req.user && req.user.user_id), featureKey: req.query.feature_key })) })),
  usage: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listUsage(c, req.query)) })),
  listVendors: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listVendors(c)) })),
  setVendor: asyncHandler(async (req, res) => { const b = req.body; res.json({ data: await req.tenantDb((c) => service.setVendor(c, { vendor: req.params.vendor, apiKey: b.api_key, patch: b, actor: actor(req) })) }); }),
  testVendor: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.testVendor(c, req.params.vendor)) })),
};
