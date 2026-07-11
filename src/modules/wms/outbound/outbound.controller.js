"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler, AppError } = require("../../../utils/errors");
const service = require("./outbound.service");

const actor = (req) => req.user || { user_id: null };
const base = makeController(service, "Outbound order");

module.exports = {
  ...base,
  setStatus: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.setStatus(c, { id: req.params.id, status: req.body.status, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Outbound order not found", 404);
    res.json({ data: row });
  }),
  listLines: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.listLines(c, req.params.id)) });
  }),
  addLine: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.addLine(c, { orderId: req.params.id, data: req.body, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Outbound order not found", 404);
    res.status(201).json({ data: row });
  }),
  setLineFlags: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) =>
      service.setLineFlags(c, {
        orderId: req.params.id,
        lineId: req.params.lineId,
        picked: req.body.picked,
        packed: req.body.packed,
        actor: actor(req),
      }),
    );
    if (!row) throw new AppError("NOT_FOUND", "Outbound line not found", 404);
    res.json({ data: row });
  }),
};
