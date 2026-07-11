"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler, AppError } = require("../../../utils/errors");
const service = require("./attendance.service");

const base = makeController(service, "Attendance");

module.exports = {
  ...base,
  clockOut: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.clockOut(c, { id: req.params.id, actor: req.user || { user_id: null } }));
    if (!row) throw new AppError("NOT_FOUND", "Attendance not found", 404);
    res.json({ data: row });
  }),
};
