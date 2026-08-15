"use strict";
const crypto = require("crypto");
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const repo = require("./vacancy.repo");
const events = require("./vacancy.events");
const scoring = require("./vacancy.scoring");
const questions = require("./vacancy.questions");

// Recruitment: vacancy head + applicant pipeline. Vacancy lifecycle
// DRAFT → OPEN → CLOSED; applicants move through their own status pipeline.
const TRANSITIONS = {
  DRAFT: ["OPEN"],
  OPEN: ["CLOSED"],
  CLOSED: [],
};

const base = makeService({ repo, moduleKey: events.MODULE, entity: "vacancy", events });

module.exports = {
  ...base,
  listApplicants: (client, vacancyId) => repo.listApplicants(client, vacancyId),

  async setStatus(client, { id, status, actor }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    const allowed = TRANSITIONS[before.status] || [];
    if (!allowed.includes(status)) {
      throw new AppError("INVALID_TRANSITION", `Cannot move vacancy ${before.status} → ${status}`, 422);
    }
    const row = await repo.update(client, id, { status });
    const entityRef = `vacancy:${id}`;
    await emitEvent(client, { eventTypeKey: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef, before, after: row });
    return row;
  },

  async addApplicant(client, { vacancyId, data, actor }) {
    const vacancy = await repo.findById(client, vacancyId);
    if (!vacancy) return null;
    /*
     * The provisional score is computed ON INSERT, not on first read.
     *
     * It is pure arithmetic over fields already in hand — no network, no model
     * call — so there is nothing to defer, and doing it here means the list is
     * ordered the moment it is opened rather than showing a column of dashes
     * until somebody runs something. `ai_provisional: true` is what stops that
     * convenience being mistaken for an assessment.
     */
    const seed = scoring.estimate(vacancy, data);
    const row = await repo.insertApplicant(client, {
      ...data,
      vacancy_id: vacancyId,
      applied_at: data.applied_at || new Date(),
      ...seed,
    });
    const entityRef = `vacancy:${vacancyId}`;
    await emitEvent(client, { eventTypeKey: events.APPLICANT_ADDED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.APPLICANT_ADDED, moduleKey: events.MODULE, entityRef, after: row });
    return row;
  },

  async setApplicantStatus(client, { vacancyId, applicantId, status, actor }) {
    const before = await repo.getApplicant(client, applicantId);
    if (!before || before.vacancy_id !== vacancyId) return null;
    const row = await repo.updateApplicant(client, applicantId, { status });
    const entityRef = `vacancy:${vacancyId}`;
    await emitEvent(client, { eventTypeKey: events.APPLICANT_UPDATED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.APPLICANT_UPDATED, moduleKey: events.MODULE, entityRef, before, after: row });

    // Hiring an applicant provisions the employee record the rest of the system
    // builds on (payroll, contracts, dispatch). Only on the transition INTO HIRED
    // so re-saving the status can't create duplicates. Runs in the caller's tx.
    if (status === "HIRED" && before.status !== "HIRED" && row.full_name) {
      // Carry the vacancy's role (title) + department onto the new employee, so
      // the profile isn't a nameless "—" the moment it's provisioned.
      //
      // `scope_id` rides along with the text (0490). This is the path that used
      // to propagate whatever spelling the vacancy happened to use into the
      // employee master, which is how one department became three; carrying the
      // reference means the new hire lands in the same node the vacancy named.
      const vacancy = await repo.findById(client, vacancyId);
      const ins = await client.query(
        "INSERT INTO employee (full_name, job_title, department, scope_id, is_active) VALUES ($1, $2, $3, $4, true) RETURNING employee_id",
        [row.full_name, vacancy?.title || null, vacancy?.department || null, vacancy?.scope_id || null],
      );
      const employeeId = ins.rows[0].employee_id;
      await emitEvent(client, { eventTypeKey: events.APPLICANT_UPDATED, moduleKey: events.MODULE, entityRef: `employee:${employeeId}`, actorUserId: actor.user_id, payload: { provisioned_from_applicant: applicantId, vacancy_id: vacancyId } });
      await audit(client, { actorUserId: actor.user_id, action: "employee_provisioned", moduleKey: events.MODULE, entityRef: `employee:${employeeId}`, after: { employee_id: employeeId, full_name: row.full_name, source: "vacancy_hire" } });
      return { ...row, provisioned_employee_id: employeeId };
    }
    return row;
  },

  /* ── Talent pool ────────────────────────────────────────────────────────
   * Not a copy into another table: `status = 'TALENT_POOL'` on the applicant
   * row keeps their CV, their score and the vacancy they came through attached
   * to them. Copying name-and-skills into `talent_pool` — which 0360 provided —
   * would have thrown away the three things that make going back to somebody
   * worthwhile. That table stays for hand-entered contacts who never applied. */
  searchPool: (client, q = {}) => repo.searchPool(client, { q: q.q, limit: q.limit }),

  /* ── AI scoring ─────────────────────────────────────────────────────────── */

  /**
   * Run the FULL assessment for one applicant and store it.
   *
   * The model call and the vault read happen OUTSIDE any transaction — they are
   * network waits of a few seconds each, and this deployment runs a
   * 12-connection-per-tenant ceiling, so holding a pooled connection across
   * them is how one slow provider takes a tenant's whole pool with it. The
   * write afterwards is a single statement.
   *
   * A model that answers unusably leaves the previous score alone rather than
   * blanking it: a provisional estimate is worth more than nothing.
   */
  async scoreApplicant(client, { vacancyId, applicantId, actor = {} }) {
    const applicant = await repo.getApplicant(client, applicantId);
    if (!applicant || applicant.vacancy_id !== vacancyId) return null;
    const vacancy = await repo.findById(client, vacancyId);
    if (!vacancy) return null;
    const criteria = await repo.listCriteria(client, vacancyId);

    const result = await scoring.assess(client, { vacancy, applicant, criteria });
    if (!result) {
      throw new AppError(
        "SCORING_UNAVAILABLE",
        "The AI didn't return a usable assessment. The previous score has been kept — try again shortly.",
        502,
      );
    }
    const row = await repo.updateApplicant(client, applicantId, { ...result, ai_scored_at: new Date() });
    const entityRef = `vacancy:${vacancyId}`;
    await audit(client, { actorUserId: actor.user_id || null, action: events.APPLICANT_SCORED, moduleKey: events.MODULE, entityRef, before: applicant, after: row });
    return row;
  },

  /* ── Custom scoring criteria ── */
  listCriteria: (client, vacancyId) => repo.listCriteria(client, vacancyId),
  async addCriterion(client, { vacancyId, data, actor = {} }) {
    if (!(await repo.findById(client, vacancyId))) return null;
    const row = await repo.insertCriterion(client, { ...data, vacancy_id: vacancyId });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CRITERIA_CHANGED, moduleKey: events.MODULE, entityRef: `vacancy:${vacancyId}`, after: row });
    return row;
  },
  async removeCriterion(client, { vacancyId, criterionId, actor = {} }) {
    const row = await repo.deleteCriterion(client, vacancyId, criterionId);
    if (!row) return null;
    await audit(client, { actorUserId: actor.user_id || null, action: events.CRITERIA_CHANGED, moduleKey: events.MODULE, entityRef: `vacancy:${vacancyId}`, before: row });
    return row;
  },

  /* ── Interview questions ── */
  listQuestions: (client, vacancyId) => repo.listQuestions(client, vacancyId),
  async addQuestion(client, { vacancyId, data, actor = {} }) {
    if (!(await repo.findById(client, vacancyId))) return null;
    const existing = await repo.listQuestions(client, vacancyId);
    const row = await repo.insertQuestion(client, {
      ...data,
      vacancy_id: vacancyId,
      ai_generated: false,
      position: data.position ?? existing.length,
    });
    await audit(client, { actorUserId: actor.user_id || null, action: events.QUESTIONS_CHANGED, moduleKey: events.MODULE, entityRef: `vacancy:${vacancyId}`, after: row });
    return row;
  },
  async removeQuestion(client, { vacancyId, questionId, actor = {} }) {
    const row = await repo.deleteQuestion(client, vacancyId, questionId);
    if (!row) return null;
    await audit(client, { actorUserId: actor.user_id || null, action: events.QUESTIONS_CHANGED, moduleKey: events.MODULE, entityRef: `vacancy:${vacancyId}`, before: row });
    return row;
  },

  /**
   * Draft the interview set.
   *
   * REPLACES ONLY THE AI-DRAFTED ROWS. A question somebody wrote themselves is
   * the one thing in the set that carries a human's judgement about this role,
   * and regenerating is an act people repeat while tuning the vacancy — losing
   * hand-written questions to it, silently, once, would be enough for nobody to
   * trust the button again.
   */
  async generateQuestions(client, { vacancyId, actor = {} }) {
    const vacancy = await repo.findById(client, vacancyId);
    if (!vacancy) return null;
    const criteria = await repo.listCriteria(client, vacancyId);
    const drafted = await questions.generate(client, { vacancy, criteria });
    if (!drafted.length) {
      throw new AppError(
        "GENERATION_UNAVAILABLE",
        "The AI didn't return any usable questions. Anything already on the list has been kept.",
        502,
      );
    }
    await repo.clearGeneratedQuestions(client, vacancyId);
    const kept = await repo.listQuestions(client, vacancyId); // the hand-written survivors
    const rows = [];
    for (const [i, q] of drafted.entries()) {
      rows.push(await repo.insertQuestion(client, {
        vacancy_id: vacancyId,
        question: q.question,
        rationale: q.rationale,
        ai_generated: true,
        position: kept.length + i,
      }));
    }
    await audit(client, { actorUserId: actor.user_id || null, action: events.QUESTIONS_CHANGED, moduleKey: events.MODULE, entityRef: `vacancy:${vacancyId}`, after: { generated: rows.length, kept: kept.length } });
    return [...kept, ...rows];
  },

  /* ── Interview scorecard ── */
  listAnswers: (client, applicantId) => repo.listAnswers(client, applicantId),
  /**
   * Rate one question for one candidate, then recompute the headline star
   * rating from every rated question. Derived, never entered directly — which
   * is why there is no endpoint that sets `rating` by hand.
   */
  async rateAnswer(client, { vacancyId, applicantId, questionId, rating, notes = null, actor = {} }) {
    const applicant = await repo.getApplicant(client, applicantId);
    if (!applicant || applicant.vacancy_id !== vacancyId) return null;
    const row = await repo.upsertAnswer(client, { applicantId, questionId, rating, notes, ratedBy: actor.user_id || null });
    const overall = await repo.recomputeRating(client, applicantId);
    await audit(client, { actorUserId: actor.user_id || null, action: events.APPLICANT_RATED, moduleKey: events.MODULE, entityRef: `vacancy:${vacancyId}`, after: { applicant_id: applicantId, question_id: questionId, rating, overall } });
    return { ...row, overall_rating: overall };
  },

  /* ── Public careers ──────────────────────────────────────────────────────
   * Publishing MINTS a token; unpublishing DISCARDS it. Re-publishing therefore
   * mints a different one, and every link handed out under the old token stops
   * working — which is the correct behaviour and worth being explicit about,
   * because the alternative (a stable token that merely toggles) means a role
   * withdrawn for a reason is one boolean flip away from being live again on a
   * URL that is already in circulation. */
  async setPublished(client, { id, published, actor = {} }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    if (published && before.status !== "OPEN") {
      throw new AppError("NOT_OPEN", "Open the vacancy before publishing it to the careers page", 422);
    }
    const patch = published
      // 32 bytes of CSPRNG, base64url. The token is the ONLY credential the
      // apply endpoint accepts, so it is generated here and never derived from
      // the vacancy id, the title or anything else an outsider could enumerate.
      ? { public_token: crypto.randomBytes(32).toString("base64url"), published_at: new Date() }
      : { public_token: null, published_at: null };
    const row = await repo.update(client, id, patch);
    const entityRef = `vacancy:${id}`;
    await emitEvent(client, { eventTypeKey: events.PUBLISHED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id || null, payload: { published } });
    // The token is a secret. `after: row` would write it into the audit trail,
    // which is broadly readable and exported — so the audit records the FACT of
    // publishing and not the credential it produced.
    await audit(client, { actorUserId: actor.user_id || null, action: events.PUBLISHED, moduleKey: events.MODULE, entityRef, after: { published, published_at: row.published_at } });
    return row;
  },
};
