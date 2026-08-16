"use strict";
const crypto = require("crypto");
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { parseDataUrl } = require("../../../utils/data-url");
const repo = require("./vacancy.repo");
const events = require("./vacancy.events");
const scoring = require("./vacancy.scoring");
const questions = require("./vacancy.questions");
const drafting = require("./vacancy.draft");
const transcription = require("../../../services/ai/transcription.service");
const vault = require("../../vault/document_vault/document_vault.service");
const { logger } = require("../../../config/logger");

/** Matches the careers form's limits — the same document either way, so a file
 *  a stranger could upload must not be one a recruiter cannot. */
const CV_MAX_BYTES = 8 * 1024 * 1024;
const CV_TYPES = ["application/pdf", "image/png", "image/jpeg"];

// Recruitment: vacancy head + applicant pipeline. Vacancy lifecycle
// DRAFT → OPEN ⇄ PAUSED → CLOSED; applicants move through their own pipeline.
//
// PAUSED (0683) is reversible and keeps the careers token, so OPEN ⇄ PAUSED is
// a round trip and resuming restores the SAME public link. CLOSED is still an
// ending: nothing leads out of it, and reopening a closed role is a new record
// rather than a state change.
const TRANSITIONS = {
  DRAFT: ["OPEN"],
  OPEN: ["PAUSED", "CLOSED"],
  PAUSED: ["OPEN", "CLOSED"],
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
     * A CV attached by hand takes the SAME road as one uploaded to the careers
     * page (0684): the vault sniffs the bytes, caps the size and refuses a type
     * it does not recognise. Without this a referral could never be scored on
     * anything but the typed fields, while an online applicant is read in full
     * — and the score column would quietly mean two different things depending
     * on how the candidate happened to arrive.
     */
    const { cv_data_url: cvDataUrl, cv_filename: cvFilename, ...fields } = data;
    if (cvDataUrl && !fields.cv_vault_id) {
      const doc = await vault.createDocument(client, {
        dataUrl: cvDataUrl,
        docType: "CV",
        entityRef: `vacancy:${vacancyId}`,
        originalName: cvFilename || null,
        maxBytes: CV_MAX_BYTES,
        allowedTypes: CV_TYPES,
        sniff: true,
        actor,
      });
      fields.cv_vault_id = doc.doc_id;
    }
    data = fields;
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

  /* ── Drafting a vacancy from an interview (0526) ─────────────────────────
   *
   * Two calls, because the interview is adaptive: the wizard asks the fixed
   * questions, sends what it has, gets the follow-ups the model wants to ask
   * about THIS role, then sends everything for the draft. Splitting it is what
   * makes the later questions specific ("what level of experience for a Junior
   * Stylist?") rather than generic. */

  /** Resolve the entity the advert speaks for: the one asked for, or the sole
   *  active one. Null is allowed — the draft simply has less to ground on. */
  async draftEntity(client, entityId) {
    return (await repo.getEntity(client, entityId)) || (await repo.soleEntity(client));
  },

  /** Every entity a vacancy could be opened under. Also the plain create form's
   *  source, so a vacancy made without the interview still knows who is hiring. */
  async hiringEntities(client) {
    const rows = await repo.listHiringEntities(client);
    return rows.map((e) => ({
      entity_id: e.entity_id,
      name: e.trading_name || e.legal_name,
      currency: e.default_currency || null,
    }));
  },

  /**
   * The questions, and who is asking them.
   *
   * On a tenant with several active entities the set OPENS with "which company
   * is hiring?", and `total` counts it — the wizard's "Question 1 of N" is
   * whatever the server says it is, so a question set that grows does not need
   * a client release. On a single-entity tenant the answer is resolved here
   * instead and the question is not asked.
   *
   * `currency` is the one the salary question is labelled in before anything is
   * answered; once the entity question IS answered, its option carries the
   * currency and the wizard relabels without another round trip.
   */
  async intakeQuestions(client, { entityId = null } = {}) {
    const entity = await this.draftEntity(client, entityId);
    // Only looked up when the answer is not already settled — a single-entity
    // tenant pays for one query here, not two.
    const rows = entity ? [] : await repo.listHiringEntities(client);
    // Not `questions` — that is the interview-question module imported above,
    // and shadowing it here would read as the wrong thing to the next person.
    const questionSet =
      rows.length > 1
        ? [drafting.entityQuestion(rows), ...drafting.BASE_QUESTIONS]
        : drafting.BASE_QUESTIONS;

    return {
      questions: questionSet,
      total: questionSet.length + drafting.FOLLOW_UP_COUNT,
      currency: (entity && entity.default_currency) || "XAF",
      entity: entity ? { entity_id: entity.entity_id, name: entity.trading_name || entity.legal_name } : null,
    };
  },

  /**
   * Turn a spoken answer into text.
   *
   * NOT wrapped in `req.tenantDb` by its controller, and that is deliberate:
   * this is a Whisper call of several seconds with no database work in it at
   * all, and holding a pooled connection across it is how one slow provider
   * takes a tenant's whole pool with it on a 12-connection ceiling.
   *
   * Throws when no provider is configured rather than returning empty text —
   * a mic button that silently does nothing is worse than one that says voice
   * input is not set up, because the person keeps pressing it.
   */
  async transcribeAnswer(dataUrl) {
    // MediaRecorder produces `audio/webm;codecs=opus`, so the media type here
    // carries a parameter. The hand-rolled pattern this replaced could not cross
    // that semicolon and rejected every real recording — see utils/data-url.
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) throw new AppError("BAD_AUDIO", "Expected a base64 audio data URL", 400);
    const audio = parsed.buffer;
    if (!audio.length) throw new AppError("EMPTY_AUDIO", "Nothing was recorded — try holding the button a little longer", 422);
    try {
      const { text } = await transcription.transcribe({ audio, mimeType: parsed.mimeType });
      return { text: String(text || "").trim() };
    } catch (err) {
      // The service throws a clear "not configured" for a missing key; anything
      // else is the provider failing. Both are the operator's problem, and both
      // must reach the user as something they can act on rather than a 500.
      throw new AppError(
        "TRANSCRIPTION_UNAVAILABLE",
        /not configured/i.test(err.message || "")
          ? "Voice input isn't set up on this workspace — type your answer, or ask your administrator to configure it."
          : "Couldn't transcribe that recording. Try again, or type your answer.",
        502,
      );
    }
  },

  /** The generated follow-ups. Model call — outside a transaction. */
  async intakeFollowUps(client, { entityId = null, answers = {} }) {
    const entity = await this.draftEntity(client, entityId);
    return { questions: await drafting.followUpQuestions(client, { entity, answers }) };
  },

  /**
   * Draft and SAVE, as a DRAFT vacancy.
   *
   * Saved rather than returned-for-preview because the recruiter has just spent
   * four minutes answering questions: the work must survive a closed tab. The
   * lifecycle already has a DRAFT state that is invisible to the careers page,
   * so nothing is published by drafting it — the editor opens on a real row
   * they can leave and come back to.
   */
  async draftVacancy(client, { entityId = null, answers = {}, actor = {} }) {
    const entity = await this.draftEntity(client, entityId);
    const drafted = await drafting.draft(client, { entity, answers });
    const { ai_provider, ...fields } = drafted;

    // `create`, not `insert`: the shared CRUD repo names it `create`, and this
    // repo adds `insertApplicant` for the child table but never an `insert`.
    // Calling one that does not exist threw a TypeError from inside the drafting
    // endpoint — after the model call had already been paid for.
    const row = await repo.create(client, {
      ...fields,
      status: "DRAFT",
      ai_generated: ai_provider !== "template",
      ai_provider,
      entity_id: entity ? entity.entity_id : null,
      headcount: Math.max(1, Math.round(Number(answers.headcount) || 1)),
      // Verbatim, so the draft can be regenerated without re-interviewing.
      intake_json: answers,
    });
    const entityRef = `vacancy:${row.vacancy_id}`;
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id || null, payload: { drafted_by: ai_provider } });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef, after: row });
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

  /**
   * Re-score every applicant on this vacancy.
   *
   * WHY IT EXISTS. Criteria and the job description are what a score MEANS, and
   * both are edited after applicants have already arrived. Without this, the
   * only way to make a shortlist comparable again is to open every candidate and
   * press Score — so in practice nobody does, and the column silently mixes
   * scores taken against three different versions of the role.
   *
   * ONE AT A TIME, DELIBERATELY. Each assessment is a model call of several
   * seconds against a 12-connection-per-tenant ceiling, so this does not fan
   * out: parallelism here would spend the tenant's pool and its AI budget at the
   * same time. The cap is the other half of that — an unbounded loop over a
   * popular role is a request that never returns.
   *
   * A FAILURE IS COUNTED, NOT THROWN. One unreadable CV must not abandon the
   * other forty applicants, and the caller is told how many of each so "12
   * scored, 3 failed" can be said out loud rather than implied by a spinner
   * that stopped.
   */
  async scoreAllApplicants(client, { vacancyId, actor = {}, limit = 100 }) {
    const vacancy = await repo.findById(client, vacancyId);
    if (!vacancy) return null;
    const applicants = await repo.listApplicants(client, vacancyId);
    const criteria = await repo.listCriteria(client, vacancyId);

    const queue = applicants.slice(0, limit);
    let scored = 0;
    let failed = 0;
    for (const applicant of queue) {
      try {
        const result = await scoring.assess(client, { vacancy, applicant, criteria });
        if (!result) {
          failed += 1;
          continue;
        }
        await repo.updateApplicant(client, applicant.applicant_id, { ...result, ai_scored_at: new Date() });
        scored += 1;
      } catch (err) {
        failed += 1;
        logger.warn({ err, applicantId: applicant.applicant_id }, "[vacancy] re-score failed for one applicant — continuing");
      }
    }

    const entityRef = `vacancy:${vacancyId}`;
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.APPLICANT_SCORED,
      moduleKey: events.MODULE,
      entityRef,
      after: { scored, failed, total: applicants.length },
    });
    return { scored, failed, total: applicants.length, skipped: Math.max(0, applicants.length - queue.length) };
  },

  /**
   * The candidate's CV, for a recruiter to READ.
   *
   * The vault's own download is gated on MOD-64 plus a per-document check —
   * correct for the document module, and wrong as the only way to open a CV:
   * a recruiter working a pipeline would need a grant over the whole document
   * vault to look at the file the candidate sent them. This serves the same
   * bytes under the recruitment grant, and only ever the CV of an applicant on
   * the vacancy in the URL, so it widens nothing else.
   */
  async applicantCv(client, { vacancyId, applicantId }) {
    const applicant = await repo.getApplicant(client, applicantId);
    if (!applicant || applicant.vacancy_id !== vacancyId) return null;
    if (!applicant.cv_vault_id) return null;
    return vault.fetchBytes(client, applicant.cv_vault_id);
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
