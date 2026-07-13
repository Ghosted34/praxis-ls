"use strict";
const service = require("./treasury_account.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => { const r = await req.tenantDb((c) => service.get(c, req.params.id)); if (!r) throw new AppError("NOT_FOUND", "Treasury account not found", 404); res.json({ data: r }); }),
  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.create(c, { entityId: b.entity_id, kind: b.kind, label: b.label, coaCode: b.coa_code, momoNetwork: b.momo_network, momoFeeAccount: b.momo_fee_account, currency: b.currency, actor: actor(req) }));
    res.status(201).json({ data });
  }),
  update: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),
  setActive: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.setActive(c, { id: req.params.id, active: req.body.active === true, actor: actor(req) })) })),

  // Payment gateways (2.3)
  listGateways: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listGateways(c)) })),
  getGateway: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.getGateway(c, req.params.provider)) })),
  upsertGateway: asyncHandler(async (req, res) => {
    const b = req.body;
    res.status(201).json({ data: await req.tenantDb((c) => service.upsertGateway(c, { provider: b.provider, active: b.active, role: b.role, credentials: b.credentials, actor: actor(req) })) });
  }),
  setGatewayActive: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.setGatewayActive(c, { provider: req.params.provider, active: req.body.active === true, actor: actor(req) })) })),
  setGatewayRole: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.setGatewayRole(c, { provider: req.params.provider, role: req.body.role, actor: actor(req) })) })),
  deleteGateway: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.deleteGateway(c, { provider: req.params.provider, actor: actor(req) })) })),
};
