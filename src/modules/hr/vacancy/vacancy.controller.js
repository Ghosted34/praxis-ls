"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { withDepartment } = require("../../../shared/rbac/department-scope");
const service = require("./vacancy.service");
const geo = require("../../../services/geoapify.service");
// Only for `fileMeta` — the content type and filename a stored document should
// be served with, which has one correct answer and belongs in one place.
const vaultController = require("../../vault/document_vault/document_vault.controller");

const actor = (req) => req.user || { user_id: null };
const base = makeController(service, "Vacancy");

module.exports = {
  ...base,
  // Department is a scope (0490). Overrides the generic create/update so the
  // reference is resolved on the identity client — the scope tree is in the live
  // schema, `vacancy` is not — and so the text snapshot can't drift from it.
  // The department is resolved BEFORE the tenant callback opens, not inside it.
  // `withDepartment` reads the identity schema, and both share one connection —
  // resolving it inside left the connection pointed at LIVE for the rest of the
  // callback, which under sandbox meant this handler looked for (and wrote) the
  // row in the wrong schema. See `withPinned` in middleware/tenant-context.
  create: asyncHandler(async (req, res) => {
    const data = await withDepartment(req, req.body);
    res.status(201).json({
      data: await req.tenantDb((c) => service.create(c, { data, actor: actor(req) })),
    });
  }),
  update: asyncHandler(async (req, res) => {
    const patch = await withDepartment(req, req.body);
    const row = await req.tenantDb((c) =>
      service.update(c, { id: req.params.id, patch, actor: actor(req) }));
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
      service.setApplicantStatus(c, {
        vacancyId: req.params.id, applicantId: req.params.applicantId,
        status: req.body.status, startsOn: req.body.starts_on || null, actor: actor(req),
      }),
    );
    if (!row) throw new AppError("NOT_FOUND", "Applicant not found", 404);
    res.json({ data: row });
  }),

  /** Put a past candidate or a bench contact in front of this vacancy (0703) —
   *  the action 0525's searchable pool was missing. */
  considerForVacancy: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) =>
      service.considerForVacancy(c, {
        vacancyId: req.params.id,
        applicantId: req.body.applicant_id || null,
        talentPoolId: req.body.talent_pool_id || null,
        actor: actor(req),
      }),
    );
    res.status(201).json({ data: row });
  }),

  /** Re-score everyone on the vacancy. Sequential model calls — see the
   *  service for why this does not fan out. */
  scoreAllApplicants: asyncHandler(async (req, res) => {
    const out = await req.tenantDb((c) =>
      service.scoreAllApplicants(c, { vacancyId: req.params.id, actor: actor(req) }));
    if (!out) throw new AppError("NOT_FOUND", "Vacancy not found", 404);
    res.json({ data: out });
  }),

  /**
   * City search for the advert's address (0684).
   *
   * The same Geoapify service the attendance module's worksite picker uses, but
   * mounted HERE with the recruitment grant: that route is gated on attendance
   * `edit`, so a recruiter typing a city into a job advert would have been asked
   * for a permission over the time clock. No `req.tenantDb` — it is an outbound
   * HTTP call with no database work in it.
   */
  placeSearch: asyncHandler(async (req, res) => {
    const { q, country, limit } = req.validatedQuery;
    res.json({ data: await geo.searchPlaces(q, { countryCodes: country ? [country] : null, limit }) });
  }),

  /* ── Drafting from an interview (0526) ── */
  hiringEntities: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.hiringEntities(c)) })),
  intakeQuestions: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.intakeQuestions(c, { entityId: req.query.entity_id || null })) })),
  intakeFollowUps: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.intakeFollowUps(c, { entityId: req.body.entity_id || null, answers: req.body.answers })) })),
  // No `req.tenantDb`: a Whisper call with no database work in it. See the
  // service — holding a pooled connection across it is how a slow provider
  // takes the tenant's whole pool.
  transcribe: asyncHandler(async (req, res) =>
    res.json({ data: await service.transcribeAnswer(req.body.audio_data_url) })),
  draftVacancy: asyncHandler(async (req, res) =>
    res.status(201).json({
      data: await req.tenantDb((c) => service.draftVacancy(c, { entityId: req.body.entity_id || null, answers: req.body.answers, actor: actor(req) })),
    })),

  /* ── AI scoring (0525) ── */
  scoreApplicant: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) =>
      service.scoreApplicant(c, { vacancyId: req.params.id, applicantId: req.params.applicantId, actor: actor(req) }));
    if (!row) throw new AppError("NOT_FOUND", "Applicant not found", 404);
    res.json({ data: row });
  }),

  /** Stream the CV inline, so a click opens it rather than downloading it.
   *  `nosniff` and an explicit content type, exactly as the vault's own
   *  download does — this is the same file taking a shorter, narrower road. */
  applicantCv: asyncHandler(async (req, res) => {
    const found = await req.tenantDb((c) =>
      service.applicantCv(c, { vacancyId: req.params.id, applicantId: req.params.applicantId }));
    if (!found) throw new AppError("NOT_FOUND", "No CV on this application", 404);
    const meta = vaultController.fileMeta(found.doc);
    res.setHeader("Content-Type", meta.contentType);
    res.setHeader("Content-Disposition", `inline; filename="${meta.filename}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(found.buffer);
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
