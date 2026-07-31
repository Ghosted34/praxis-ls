"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler } = require("../../../utils/errors");
const service = require("./hr_sanction.service");

const base = makeController(service, "Sanction");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  ...base,
  mine: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.mine(c, req.user.employee_id)) })),
  lift: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.lift(c, { id: req.params.id, actor: actor(req) })) })),
};
