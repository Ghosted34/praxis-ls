"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler, AppError } = require("../../../utils/errors");
const service = require("./equipment.service");

const base = makeController(service, "Equipment");

module.exports = {
  ...base,
  setStatus: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) =>
      service.setStatus(c, {
        id: req.params.id,
        status: req.body.status,
        assigned_to: req.body.assigned_to,
        actor: req.user || { user_id: null },
      }),
    );
    if (!row) throw new AppError("NOT_FOUND", "Equipment not found", 404);
    res.json({ data: row });
  }),
};
