"use strict";
const service = require("./workspace.service");
const { asyncHandler } = require("../../../utils/errors");
module.exports = {
  mine: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.mine(c, req.user || { user_id: null })) })),
};
