"use strict";
const service = require("./purchase_request.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Purchase request not found", 404);
    res.json({ data: row });
  }),
  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.createDraft(c, { requestedBy: b.requested_by, department: b.department, justification: b.justification, lines: b.lines, actor: actor(req) }));
    res.status(201).json({ data });
  }),
  transition: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.transition(c, { id: req.params.id, to: b.to, entityId: b.entity_id, date: b.date, actor: actor(req) }));
    res.json({ data });
  }),
};
