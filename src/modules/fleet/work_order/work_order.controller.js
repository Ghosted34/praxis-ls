"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler, AppError } = require("../../../utils/errors");
const service = require("./work_order.service");

const base = makeController(service, "Work order");

module.exports = {
  ...base,
  setStatus: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) =>
      service.setStatus(c, { id: req.params.id, status: req.body.status, actor: req.user || { user_id: null } }),
    );
    if (!row) throw new AppError("NOT_FOUND", "Work order not found", 404);
    res.json({ data: row });
  }),
  listParts: asyncHandler(async (req, res) => {
    const rows = await req.tenantDb((c) => service.listParts(c, { id: req.params.id }));
    res.json({ data: rows });
  }),
  addPart: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) =>
      service.addPart(c, { id: req.params.id, data: req.body, actor: req.user || { user_id: null } }),
    );
    if (!row) throw new AppError("NOT_FOUND", "Work order not found", 404);
    res.status(201).json({ data: row });
  }),
};
