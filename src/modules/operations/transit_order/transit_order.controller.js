"use strict";
const service = require("./transit_order.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Transit order not found", 404);
    res.json({ data: row });
  }),
  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.create(c, { entityId: b.entity_id, dossierId: b.dossier_id, customsRegime: b.customs_regime, serviceDirection: b.service_direction, declaredValue: b.declared_value, submittedDocs: b.submitted_docs || [], lines: b.lines, date: b.date, actor: actor(req) }));
    res.status(201).json({ data });
  }),
  update: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.updateDocs(c, { transitOrderId: req.params.id, submittedDocs: req.body.submitted_docs || [], actor: actor(req) }));
    res.json({ data });
  }),
};
