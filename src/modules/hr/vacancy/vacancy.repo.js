"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { insertOne, updateOne, getById, listComplete } = require("../../../shared/db/query-helpers");

/**
 * What "still hiring" means, in one place.
 *
 * Three queries below ask it, and a predicate copied three times is a predicate
 * that will disagree with itself the first time somebody adds a state to it.
 */
const ACTIVE_ENTITY = "COALESCE(registration_status, 'ACTIVE') <> 'INACTIVE'";

/**
 * The entity as the drafting model is allowed to see it.
 *
 * Only the columns an advert can honestly use — NOT share capital, tax ids or
 * registration numbers: they are on the record, irrelevant to a job advert, and
 * every one sent to a third-party model is a disclosure nobody asked for.
 *
 * The name column is `legal_name` (0100), NOT `name`. Selecting `name` is a
 * 42703 that the error handler turns into a 500 "A required column is missing",
 * which is what the whole drafting interview did on every call.
 */
const ENTITY_COLUMNS = `SELECT entity_id, legal_name, trading_name, description, industry, legal_form,
                incorporation_place, incorporation_country, headcount, website,
                default_currency, payroll_country, timezone
           FROM corporate_entity`;

// vacancy head + job_applicant children. All SQL lives here.
const base = makeRepo({
  table: "vacancy",
  pk: "vacancy_id",
  activeColumn: null,
  searchColumn: "title",
  orderBy: "created_at DESC",
  // First adopter of record-level scope (audit finding A2). The mechanism has
  // existed since scopes were wired into requirePermission and NO repo declared
  // a column, so `req.scope_ids` was computed on every request and filtered
  // nothing. 0490 gave this table a scope_id, so it can opt in.
  //
  // Effect: a user assigned to a branch sees that branch's vacancies and those
  // beneath it (the closure). A user with no assignment is unrestricted, as
  // before, and a vacancy with no scope stays visible to everyone.
  scopeColumn: "scope_id",
  // API F-29: explicit allow-list; anything else is refused, not interpolated.
  sortable: ["created_at", "title"],
  // API F-28: this repo uses makeRepo's list unchanged, which honours only
  // limit/offset/q — any other key was silently ignored. Now it is named.
  filterable: [],
});

module.exports = {
  ...base,
  insertApplicant: (client, data) => insertOne(client, "job_applicant", data),
  getApplicant: (client, id) => getById(client, "job_applicant", "applicant_id", id),
  updateApplicant: (client, id, patch) => updateOne(client, "job_applicant", "applicant_id", id, patch),
  async listApplicants(client, vacancyId) {
    // Best score first, then most recent. Was created_at alone, which put the
    // ordering the scorer exists to produce behind a manual sort. NULLS LAST so
    // an unscored applicant sits below scored ones rather than on top of them.
    const { rows } = await listComplete(
      client,
      "SELECT * FROM job_applicant WHERE vacancy_id = $1 ORDER BY ai_score DESC NULLS LAST, created_at DESC",
      [vacancyId],
      { label: "Job applicants", ceiling: 5000 },
    );
    return rows;
  },

  /* ── Talent pool search (0525) ──────────────────────────────────────────
   * Everyone previously seen who was NOT hired and is not still live in a
   * pipeline. Deliberately spans vacancies — the whole value of the pool is
   * that the right person for this role applied for a different one. */
  async searchPool(client, { q = null, limit = 50 } = {}) {
    const params = [Math.min(Number(limit) || 50, 200)];
    let filter = "";
    if (q && String(q).trim()) {
      params.push(`%${String(q).trim()}%`);
      const p = "$" + params.length;
      // Skills is a text[]; array_to_string lets one ILIKE cover the name, the
      // stated skills and the model's own summary without three parameters.
      filter = `AND (a.full_name ILIKE ${p} OR array_to_string(a.skills, ' ') ILIKE ${p} OR a.ai_summary ILIKE ${p})`;
    }
    const { rows } = await client.query(
      `SELECT a.*, v.title AS vacancy_title
         FROM job_applicant a
         LEFT JOIN vacancy v ON v.vacancy_id = a.vacancy_id
        WHERE a.status IN ('TALENT_POOL', 'REJECTED') ${filter}
        ORDER BY a.ai_score DESC NULLS LAST, a.applied_at DESC NULLS LAST
        LIMIT $1`,
      params,
    );
    return rows;
  },

  /* ── The hiring entity (0526) ──────────────────────────────────────────
   * Grounding for the drafting wizard. See ENTITY_COLUMNS above for what is
   * read and what is deliberately not. */
  getEntity(client, entityId) {
    if (!entityId) return Promise.resolve(null);
    return client
      .query(`${ENTITY_COLUMNS} WHERE entity_id = $1`, [entityId])
      .then((r) => r.rows[0] || null);
  },
  /** The sole active entity, when a tenant has exactly one — so a single-entity
   *  workspace is never asked a question with one possible answer. Returns null
   *  when there are none or several, and the caller then asks which. */
  soleEntity(client) {
    return client
      .query(`${ENTITY_COLUMNS} WHERE ${ACTIVE_ENTITY} LIMIT 2`)
      .then((r) => (r.rows.length === 1 ? r.rows[0] : null));
  },
  /**
   * Every entity that could be doing the hiring, for the "which company?"
   * question and for the plain create form.
   *
   * Deliberately NOT the corporate-entity module's list endpoint: that one is
   * gated on the master-data grant, and a recruiter who can post a vacancy is
   * not necessarily allowed to browse the group structure. This returns the
   * three fields naming a choice — and the currency, so the salary question can
   * be labelled the moment one is picked rather than after a round trip.
   */
  listHiringEntities(client) {
    return client
      .query(
        `SELECT entity_id, legal_name, trading_name, default_currency
           FROM corporate_entity
          WHERE ${ACTIVE_ENTITY}
          ORDER BY COALESCE(trading_name, legal_name) ASC`,
      )
      .then((r) => r.rows);
  },

  /* ── Custom scoring criteria ── */
  listCriteria(client, vacancyId) {
    return client
      .query("SELECT * FROM vacancy_criterion WHERE vacancy_id = $1 ORDER BY position, created_at", [vacancyId])
      .then((r) => r.rows);
  },
  insertCriterion: (client, data) => insertOne(client, "vacancy_criterion", data),
  deleteCriterion(client, vacancyId, id) {
    // Scoped by vacancy as well as id: the route reaches this through
    // /vacancies/:id/criteria/:criterionId, and a criterion id belonging to a
    // different vacancy must not be deletable just because the caller can see
    // some vacancy.
    return client
      .query("DELETE FROM vacancy_criterion WHERE vacancy_criterion_id = $1 AND vacancy_id = $2 RETURNING *", [id, vacancyId])
      .then((r) => r.rows[0] || null);
  },

  /* ── Interview questions ── */
  listQuestions(client, vacancyId) {
    return client
      .query("SELECT * FROM vacancy_question WHERE vacancy_id = $1 ORDER BY position, created_at", [vacancyId])
      .then((r) => r.rows);
  },
  insertQuestion: (client, data) => insertOne(client, "vacancy_question", data),
  updateQuestion: (client, id, patch) => updateOne(client, "vacancy_question", "vacancy_question_id", id, patch),
  deleteQuestion(client, vacancyId, id) {
    return client
      .query("DELETE FROM vacancy_question WHERE vacancy_question_id = $1 AND vacancy_id = $2 RETURNING *", [id, vacancyId])
      .then((r) => r.rows[0] || null);
  },
  /** Replace the AI-drafted questions only. Hand-written ones survive a
   *  regenerate — see vacancy.questions.js. */
  clearGeneratedQuestions(client, vacancyId) {
    return client.query("DELETE FROM vacancy_question WHERE vacancy_id = $1 AND ai_generated = true", [vacancyId]);
  },

  /* ── Interview scorecard ── */
  listAnswers(client, applicantId) {
    return client
      .query("SELECT * FROM applicant_answer WHERE applicant_id = $1", [applicantId])
      .then((r) => r.rows);
  },
  /** One row per (applicant, question) — rating twice UPDATES, so the average
   *  below can never double-count a revised opinion. */
  upsertAnswer(client, { applicantId, questionId, rating, notes, ratedBy }) {
    return client
      .query(
        `INSERT INTO applicant_answer (applicant_id, vacancy_question_id, rating, notes, rated_by)
              VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (applicant_id, vacancy_question_id) DO UPDATE
            SET rating = EXCLUDED.rating, notes = EXCLUDED.notes,
                rated_by = EXCLUDED.rated_by, rated_at = now()
          RETURNING *`,
        [applicantId, questionId, rating, notes, ratedBy],
      )
      .then((r) => r.rows[0]);
  },
  /** The overall star rating, recomputed from the per-question rows and written
   *  back. Derived rather than separately maintained so the headline figure and
   *  the scorecard it summarises can never disagree. */
  async recomputeRating(client, applicantId) {
    const { rows } = await client.query(
      "UPDATE job_applicant SET rating = (SELECT round(avg(rating)::numeric, 1) FROM applicant_answer WHERE applicant_id = $1 AND rating IS NOT NULL) WHERE applicant_id = $1 RETURNING rating",
      [applicantId],
    );
    return rows[0] ? rows[0].rating : null;
  },

  /* ── Public careers ── */
  publishedList(client) {
    return client
      .query(
        `SELECT vacancy_id, public_token, title, department, location, employment_type,
                description, salary_min, salary_max, salary_currency, experience_years_min,
                skills_required, closes_on, published_at
           FROM vacancy
          WHERE status = 'OPEN' AND public_token IS NOT NULL
            AND (closes_on IS NULL OR closes_on >= current_date)
          ORDER BY published_at DESC NULLS LAST`,
      )
      .then((r) => r.rows);
  },
  /**
   * One published vacancy by its token — the ONLY lookup the unauthenticated
   * surface performs, and it is by token rather than by id on purpose: a
   * vacancy_id appears in admin URLs and logs, so accepting one here would make
   * every internal id a public credential. The status and closing-date filters
   * are IN THE QUERY rather than checked afterwards, so a closed role is
   * indistinguishable from one that never existed.
   */
  publishedByToken(client, token) {
    return client
      .query(
        `SELECT vacancy_id, public_token, title, department, location, employment_type,
                description, salary_min, salary_max, salary_currency, experience_years_min,
                skills_required, closes_on, published_at
           FROM vacancy
          WHERE public_token = $1 AND status = 'OPEN'
            AND (closes_on IS NULL OR closes_on >= current_date)`,
        [token],
      )
      .then((r) => r.rows[0] || null);
  },
};
