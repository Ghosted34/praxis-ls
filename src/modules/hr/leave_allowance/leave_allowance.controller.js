"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler, AppError } = require("../../../utils/errors");
const service = require("./leave_allowance.service");

const base = makeController(service, "Leave request");

module.exports = {
  ...base,
  decide: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.decide(c, { id: req.params.id, status: req.body.status, actor: req.user || { user_id: null } }));
    if (!row) throw new AppError("NOT_FOUND", "Leave request not found", 404);
    res.json({ data: row });
  }),
};
