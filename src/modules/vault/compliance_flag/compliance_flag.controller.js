"use strict";
const service = require("./compliance_flag.service");
const { asyncHandler } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  catalogue: asyncHandler(async (_req, res) => res.json({ data: service.catalogue() })),
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  run: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.run(c, { rules: req.body.rules, actor: actor(req) })) })),
  resolve: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.resolve(c, { id: req.params.id, actor: actor(req) })) })),
};
