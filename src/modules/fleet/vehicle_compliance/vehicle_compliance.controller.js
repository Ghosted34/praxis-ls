"use strict";
const { makeController } = require("../../../shared/crud/resource");
const service = require("./vehicle_compliance.service");
const { asyncHandler } = require("../../../utils/errors");

const base = makeController(service, "Compliance");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  ...base,
  expiring: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.expiring(c, { days: Number(req.query.days) || 30 })) })),
  scan: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.scanExpiring(c, { days: Number(req.body?.days) || 30, actor: actor(req) })) })),
};
