"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler, AppError } = require("../../../utils/errors");
const service = require("./inbound.service");

const base = makeController(service, "GRN inbound");

module.exports = {
  ...base,
  setQa: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) =>
      service.setQa(c, {
        id: req.params.id,
        qa_status: req.body.qa_status,
        putaway_location: req.body.putaway_location,
        actor: req.user || { user_id: null },
      }),
    );
    if (!row) throw new AppError("NOT_FOUND", "GRN inbound not found", 404);
    res.json({ data: row });
  }),
};
