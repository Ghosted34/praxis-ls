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

  /* ── AI scoring (0525) ── */
  scoreApplicant: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) =>
      service.scoreApplicant(c, { vacancyId: req.params.id, applicantId: req.params.applicantId, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Applicant not found", 404);
    res.json({ data: row });
  }),

  /* ── Custom scoring criteria ── */
  listCriteria: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.listCriteria(c, req.params.id)) })),
  addCriterion: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.addCriterion(c, { vacancyId: req.params.id, data: req.body, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Vacancy not found", 404);
    res.status(201).json({ data: row });
  }),
  removeCriterion: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.removeCriterion(c, { vacancyId: req.params.id, criterionId: req.params.criterionId, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Criterion not found", 404);
    res.json({ data: row });
  }),

  /* ── Interview questions ── */
  listQuestions: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.listQuestions(c, req.params.id)) })),
  addQuestion: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.addQuestion(c, { vacancyId: req.params.id, data: req.body, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Vacancy not found", 404);
    res.status(201).json({ data: row });
  }),
  removeQuestion: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.removeQuestion(c, { vacancyId: req.params.id, questionId: req.params.questionId, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Question not found", 404);
    res.json({ data: row });
  }),
  generateQuestions: asyncHandler(async (req, res) => {
    const rows = await req.tenantDb((c) => service.generateQuestions(c, { vacancyId: req.params.id, actor: actor(req) }));
    if (!rows) throw new AppError("NOT_FOUND", "Vacancy not found", 404);
    res.json({ data: rows });
  }),

  /* ── Interview scorecard ── */
  listAnswers: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.listAnswers(c, req.params.applicantId)) })),
  rateAnswer: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.rateAnswer(c, {
      vacancyId: req.params.id, applicantId: req.params.applicantId,
      questionId: req.body.vacancy_question_id, rating: req.body.rating,
      notes: req.body.notes ?? null, actor: actor(req),
    }));
    if (!row) throw new AppError("NOT_FOUND", "Applicant not found", 404);
    res.json({ data: row });
  }),

  /* ── Talent pool + publishing ── */
  searchPool: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.searchPool(c, { q: req.query.q, limit: req.query.limit })) })),
  setPublished: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.setPublished(c, { id: req.params.id, published: req.body.published, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Vacancy not found", 404);
    res.json({ data: row });
  }),
};
