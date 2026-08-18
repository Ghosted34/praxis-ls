"use strict";
const service = require("./godmode.service");
const { asyncHandler } = require("../../../utils/errors");
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listPurgeable(c)) })),
  dependencies: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.dependencies(c, { softDeleteId: req.params.id })) })),
  purge: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.purge(c, { actor: req.user || { user_id: null }, softDeleteId: req.body.soft_delete_id, pin: req.body.pin, ip: req.ip })) })),
};
