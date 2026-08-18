"use strict";
const service = require("./purchase_request.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { withDepartment } = require("../../../shared/rbac/department-scope");
const { enqueueDocument } = require("../../../services/documents/generate");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query, req.scope_ids ?? null)) })),
  get: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Purchase request not found", 404);
    res.json({ data: row });
  }),
  create: asyncHandler(async (req, res) => {
    // Department is a scope (0490). Resolved on the identity client because the
    // scope tree lives in the live schema while this row does not — see
    // shared/rbac/department-scope.js.
    const b = await withDepartment(req, req.body);
    const data = await req.tenantDb((c) => service.createDraft(c, { requestedBy: b.requested_by, department: b.department, scopeId: b.scope_id, justification: b.justification, lines: b.lines, actor: actor(req) }));
    res.status(201).json({ data });
  }),
  transition: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.transition(c, { id: req.params.id, to: b.to, entityId: b.entity_id, date: b.date, actor: actor(req) }));
    // Submitting numbers + captures the request — mint its PDF then too.
    if (data && b.to === "SUBMITTED") {
      enqueueDocument({ tenantMeta: req.tenant, env: req.env, docType: "PURCHASE_REQUEST", recordId: req.params.id });
    }
    res.json({ data });
  }),
};
