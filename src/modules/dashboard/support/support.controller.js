"use strict";
/** Tenant-side Support & Feedback controller — thin. Tickets are scoped to the
 *  caller's tenant (req.tenant.tenant_id) and stamped with their email. */
const service = require("./support.service");
const { asyncHandler } = require("../../../utils/errors");

const tenantId = (req) => req.tenant.tenant_id;
const email = (req) => (req.user ? req.user.email : null);

module.exports = {
  create: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await service.create(tenantId(req), email(req), req.body) }),
  ),
  list: asyncHandler(async (req, res) =>
    res.json({ data: await service.list(tenantId(req), { status: req.query.status }) }),
  ),
  get: asyncHandler(async (req, res) =>
    res.json({ data: await service.get(tenantId(req), req.params.id) }),
  ),
  csat: asyncHandler(async (req, res) =>
    res.json({ data: await service.submitCsat(tenantId(req), req.params.id, req.body.csat) }),
  ),
};
