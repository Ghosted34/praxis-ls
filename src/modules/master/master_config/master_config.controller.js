"use strict";
const service = require("./master_config.service");
const { asyncHandler } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  get: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.getEffective(c, req.params.appliesTo)) })),
  // Accepts either `{ fields: [...] }` or a bare array body.
  put: asyncHandler(async (req, res) =>
    res.json({
      data: await req.tenantDb((c) =>
        service.put(c, { appliesTo: req.params.appliesTo, fields: Array.isArray(req.body) ? req.body : req.body.fields, actor: actor(req) }),
      ),
    })),
};
