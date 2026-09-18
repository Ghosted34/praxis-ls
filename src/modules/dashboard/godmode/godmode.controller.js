// ai:none — the Praxis-side cross-tenant admin console. A tenant's copilot must not be able to see, let alone act, across tenants.
"use strict";
const service = require("./godmode.service");
const { asyncHandler } = require("../../../utils/errors");
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listPurgeable(c)) })),
  dependencies: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.dependencies(c, { softDeleteId: req.params.id })) })),
  setPin: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.setPin(c, { actor: req.user || { user_id: null }, pin: req.body.pin })) })),
  purge: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.purge(c, { actor: req.user || { user_id: null }, softDeleteId: req.body.soft_delete_id, pin: req.body.pin, ip: req.ip })) })),
};
