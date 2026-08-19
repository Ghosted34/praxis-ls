"use strict";
const service = require("./margin_simulation.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Simulation not found", 404);
    res.json({ data: row });
  }),
  preview: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.preview(c, { lines: req.body.lines || [] })) })),
  // LINK COSTING (§3.1): the costing's lines, converted and mapped for import.
  fromCosting: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.fromCosting(c, { costingId: req.params.costingId })) })),
  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.create(c, {
      dossierId: b.dossier_id, serviceTypeId: b.service_type_id, costingId: b.costing_id,
      currency: b.currency, lines: b.lines || [], actor: actor(req),
    }));
    res.status(201).json({ data });
  }),
  submit: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.submit(c, { id: req.params.id, actor: actor(req) })) })),
  approve: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.approve(c, { id: req.params.id, actor: actor(req) })) })),
  reject: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.reject(c, { id: req.params.id, reason: req.body.reason, actor: actor(req) })) })),
  quote: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await req.tenantDb((c) => service.quote(c, { id: req.params.id, actor: actor(req) })) })),
};
