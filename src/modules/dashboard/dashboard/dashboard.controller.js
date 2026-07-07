"use strict";
const service = require("./dashboard.service");
const { asyncHandler } = require("../../../utils/errors");
module.exports = {
  kpis: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.kpis(c)) })),
};
