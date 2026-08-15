"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const APPLICANT_STATUS = ["APPLIED", "SHORTLISTED", "INTERVIEWED", "HIRED", "REJECTED", "TALENT_POOL"];

/** Skills are matched by substring in the scorer, so blanks and duplicates are
 *  stripped HERE rather than being scored as a required skill nobody can meet. */
const skills = z.array(z.string().trim().min(1).max(80)).max(40)
  .transform((a) => [...new Set(a.map((s) => s.trim()).filter(Boolean))]);

/**
 * The object, kept separate from the refinement.
 *
 * `.refine()` returns a ZodEffects, which has no `.partial()` — so building
 * `create` with the refinement inline and then calling `create.partial()` for
 * the update schema throws at require time, and the module loader would skip
 * the whole module with a logged error rather than crashing the boot. The base
 * stays a plain object so both shapes can be derived from it and BOTH can carry
 * the salary-range check.
 */
const createShape = z.object({
  title: z.string().min(1),
  // Department is a scope (0490) — carried onto the employee record at hire.
  scope_id: z.string().uuid().optional().nullable(),
  department: z.string().optional(),
  description: z.string().optional(),
  ai_generated: z.boolean().optional(),
  status: z.enum(["DRAFT", "OPEN", "PAUSED", "CLOSED"]).optional(),
  posted_to_website: z.boolean().optional(),
  // 0525 — the structured shape the scorer compares against. All optional: a
  // vacancy with none of it still works, the scorer simply has fewer dimensions
  // to speak to (and says so, rather than inventing them).
  employment_type: z.string().max(60).optional(),
  location: z.string().max(160).optional(),
  experience_years_min: z.coerce.number().int().min(0).max(60).optional(),
  skills_required: skills.optional(),
  salary_min: z.coerce.number().nonnegative().optional(),
  salary_max: z.coerce.number().nonnegative().optional(),
  salary_currency: z.string().length(3).optional(),
  closes_on: z.string().date().optional(),
  // 0526 — which corporate entity is hiring. Optional: a single-entity tenant
  // is not asked a question with one possible answer (the service resolves the
  // sole active entity). It decides the salary currency and grounds the AI, so
  // the blank-form path must be able to set it too, not just the wizard.
  entity_id: z.string().uuid().optional().nullable(),
  headcount: z.coerce.number().int().min(1).max(500).optional(),
});

// Mirrors ck_vacancy_salary_range. Applied to both create and update so the
// user gets a named field error rather than a 500 from a constraint violation —
// and applied to update in particular because raising only `salary_min` on an
// existing row is the likeliest way to invert the band.
// `=== undefined || === null` rather than `== null`: both are reachable and the
// repo's eqeqeq rule refuses the shorthand. On the update schema every field is
// optional, so an absent bound arrives as undefined; an explicit clear arrives
// as null. Either one means "there is no bound to compare against".
const absent = (v) => v === undefined || v === null;
const salaryOrder = (v) => absent(v.salary_min) || absent(v.salary_max) || v.salary_max >= v.salary_min;
const SALARY_ORDER_ERROR = { message: "The top of the salary band must not be below the bottom", path: ["salary_max"] };

const create = createShape.refine(salaryOrder, SALARY_ORDER_ERROR);
const update = createShape.partial().refine(salaryOrder, SALARY_ORDER_ERROR);

const status = z.object({ status: z.enum(["DRAFT", "OPEN", "CLOSED"]) });
const applicant = z.object({
  full_name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  cv_vault_id: z.string().uuid().optional(),
  answers_json: z.record(z.any()).optional(),
  // 0525 — what the provisional score reads.
  address: z.string().max(300).optional(),
  skills: skills.optional(),
  experience_years: z.coerce.number().min(0).max(70).optional(),
  expected_salary: z.coerce.number().nonnegative().optional(),
  portfolio_url: z.string().url().max(500).optional(),
  cover_note: z.string().max(5000).optional(),
  source: z.string().max(60).optional(),
});
const applicantStatus = z.object({ status: z.enum(APPLICANT_STATUS) });

const criterion = z.object({
  label: z.string().trim().min(1).max(200),
  guidance: z.string().max(1000).optional(),
  // Relative, not a percentage — the scorer normalises across the set.
  weight: z.coerce.number().positive().max(10).optional(),
  position: z.coerce.number().int().min(0).optional(),
});
const question = z.object({
  question: z.string().trim().min(8).max(1000),
  rationale: z.string().max(1000).optional(),
  position: z.coerce.number().int().min(0).optional(),
});
/** Half-stars, 0..5. `rating: null` is explicitly allowed — an interviewer
 *  clearing a rating they entered by mistake must be able to, and omitting the
 *  key would instead leave the old value in place. */
const answer = z.object({
  vacancy_question_id: z.string().uuid(),
  rating: z.coerce.number().min(0).max(5).multipleOf(0.5).nullable(),
  notes: z.string().max(4000).optional(),
});
const publish = z.object({ published: z.boolean() });

/**
 * The interview answers (0526).
 *
 * `passthrough()`, and that is the point: the later questions are GENERATED, so
 * their keys cannot be enumerated here without the schema having to be edited
 * every time the model asks something new. Each value is bounded instead —
 * these are free text from a human, they are stored verbatim in `intake_json`,
 * and they are forwarded to a model, so length is the control that matters.
 */
const intakeAnswers = z.record(
  z.union([z.string().max(4000), z.number(), z.boolean(), z.null()]),
);
const intake = z.object({
  entity_id: z.string().uuid().optional().nullable(),
  answers: intakeAnswers,
});

/**
 * A spoken answer, as a base64 data URL.
 *
 * ~2.7 MB of base64 for 2 MB of audio, which at Opus bitrates is several
 * minutes — far more than any answer to "where is the role based?" needs, and
 * small enough that a stalled upload is not a hung browser tab. The cap is the
 * cheap outer bound: it stops a large blob being base64-decoded into memory
 * before anything looks at it.
 */
const transcribe = z.object({
  audio_data_url: z.string().min(32).max(2_800_000),
});

const schemas = { create, update, status, applicant, applicantStatus, criterion, question, answer, publish, intake, transcribe };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  create: mw("create"),
  update: mw("update"),
  status: mw("status"),
  applicant: mw("applicant"),
  applicantStatus: mw("applicantStatus"),
  criterion: mw("criterion"),
  question: mw("question"),
  answer: mw("answer"),
  publish: mw("publish"),
  intake: mw("intake"),
  transcribe: mw("transcribe"),
  schemas,
};
