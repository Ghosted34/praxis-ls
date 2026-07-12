"use strict";
const service = require("./setting.service");
const { asyncHandler } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  all: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.all(c)) })),
  sections: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.sections(c)) })),
  section: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.section(c, req.params.section)) })),
  get: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.get(c, req.params.section, req.params.key)) })),
  put: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.put(c, { section: req.params.section, key: req.params.key, value: req.body.value, actor: actor(req) })) })),
  remove: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.remove(c, { section: req.params.section, key: req.params.key, actor: actor(req) })) })),
};
