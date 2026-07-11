/** Employee master (MOD-02) HTTP handlers — thin: req.tenantDb → service. */
"use strict";
const service = require("./employees.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  roster: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.roster(c, req.query)) })),
  drivers: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.drivers(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Employee not found", 404);
    res.json({ data: r });
  }),
  references: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.references(c, req.params.id)) })),
  create: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.create(c, { data: req.body, actor: actor(req) })) })),
  update: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) })) })),
  setActive: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.setActive(c, { id: req.params.id, is_active: req.body.is_active, actor: actor(req) })) })),
  remove: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.remove(c, { id: req.params.id, actor: actor(req) })) })),
};
