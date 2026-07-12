"use strict";
const service = require("./inbound_intake.service");
const { asyncHandler } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  listEnquiries: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listEnquiries(c, req.query)) })),
  listPartnerships: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listPartnerships(c, req.query)) })),
  createEnquiry: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.submitEnquiry(c, { data: req.body, actor: actor(req) })) })),
  triage: asyncHandler(async (req, res) => { const b = req.body; res.json({ data: await req.tenantDb((c) => service.triageEnquiry(c, { id: req.params.id, toLead: b.to_lead === true, close: b.close === true, actor: actor(req) })) }); }),
  createPartnership: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.submitPartnership(c, { data: req.body, actor: actor(req) })) })),
  reviewPartnership: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.reviewPartnership(c, { id: req.params.id, status: req.body.status, actor: actor(req) })) })),
};
