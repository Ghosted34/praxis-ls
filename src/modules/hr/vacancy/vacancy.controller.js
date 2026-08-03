"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { withDepartment } = require("../../../shared/rbac/department-scope");
const service = require("./vacancy.service");

const actor = (req) => req.user || { user_id: null };
const base = makeController(service, "Vacancy");

module.exports = {
  ...base,
  // Department is a scope (0490). Overrides the generic create/update so the
  // reference is resolved on the identity client — the scope tree is in the live
  // schema, `vacancy` is not — and so the text snapshot can't drift from it.
  create: asyncHandler(async (req, res) =>
    res.status(201).json({
      data: await req.tenantDb(async (c) =>
        service.create(c, { data: await withDepartment(req, req.body), actor: actor(req) })),
    })),
  update: asyncHandler(async (req, res) => {
    const row = await req.tenantDb(async (c) =>
      service.update(c, { id: req.params.id, patch: await withDepartment(req, req.body), actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Vacancy not found", 404);
    res.json({ data: row });
  }),
  setStatus: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.setStatus(c, { id: req.params.id, status: req.body.status, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Vacancy not found", 404);
    res.json({ data: row });
  }),
  listApplicants: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.listApplicants(c, req.params.id)) });
  }),
  addApplicant: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.addApplicant(c, { vacancyId: req.params.id, data: req.body, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Vacancy not found", 404);
    res.status(201).json({ data: row });
  }),
  setApplicantStatus: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) =>
      service.setApplicantStatus(c, { vacancyId: req.params.id, applicantId: req.params.applicantId, status: req.body.status, actor: actor(req) }),
    );
    if (!row) throw new AppError("NOT_FOUND", "Applicant not found", 404);
    res.json({ data: row });
  }),
};
