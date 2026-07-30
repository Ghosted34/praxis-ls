"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler, AppError } = require("../../../utils/errors");
const service = require("./leave_allowance.service");

const base = makeController(service, "Leave request");

module.exports = {
  ...base,
  mine: asyncHandler(async (req, res) => {
    const eid = req.user.employee_id;
    if (!eid) return res.json({ data: [] });
    return res.json({ data: await req.tenantDb((c) => service.list(c, { employee_id: eid })) });
  }),
  decide: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.decide(c, { id: req.params.id, status: req.body.status, actor: req.user || { user_id: null } }));
    if (!row) throw new AppError("NOT_FOUND", "Leave request not found", 404);
    res.json({ data: row });
  }),
};
