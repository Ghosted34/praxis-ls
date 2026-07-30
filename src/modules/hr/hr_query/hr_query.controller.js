"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler } = require("../../../utils/errors");
const service = require("./hr_query.service");

const base = makeController(service, "HR query");

module.exports = {
  ...base,
  mine: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.mine(c, req.user.employee_id)) })),
  respond: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.respond(c, { id: req.params.id, employeeId: req.user.employee_id, response: req.body.response })) })),
};
