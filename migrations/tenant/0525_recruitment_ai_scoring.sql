-- ============================================================================
-- TENANT DB — 0525 recruitment: AI scoring, interview scorecards, public careers
--
-- WHERE THE PIPELINE STOPPED. 0360 gave a vacancy a title and an applicant a
-- name, an email and a status. Everything that makes recruiting more than a list
-- of names — why this candidate over that one, what to ask them, how they
-- answered, and how they got here at all — had nowhere to live. In practice that
-- meant the shortlist was decided in someone's inbox and the pipeline was a
-- record of a decision already made elsewhere.
--
-- FOUR THINGS ARE ADDED, and the seams between them are deliberate.
--
--   1. WHAT THE ROLE ASKS FOR (vacancy columns + vacancy_criterion). Structured,
--      because the scorer has to compare against something, and a job
--      description in prose is not a comparison.
--   2. WHAT THE CANDIDATE BROUGHT (job_applicant columns). Self-reported at
--      apply time, which is why it is stored separately from anything the CV
--      says — see the two-tier note below.
--   3. WHAT THE MODEL THOUGHT (ai_* columns). Timestamped, model-stamped, and
--      flagged provisional-or-not.
--   4. WHAT A HUMAN THOUGHT (vacancy_question + applicant_answer). Separate
--      tables, separate ratings, and NEVER merged into the AI's number.
--
-- ── WHY THE AI SCORE IS TWO-TIER, IN THE SCHEMA AND NOT JUST THE UI ─────────
--
-- `ai_provisional` is the single most important column here. A cheap heuristic
-- over the fields a candidate typed about themselves is useful — it orders a
-- hundred applications in a second and costs nothing. It is also, precisely, a
-- score of how well someone described themselves, and it has NOT opened the CV.
-- A full read of the résumé against the job description is a different claim
-- with a different cost.
--
-- Storing both in one `ai_score` with no marker is how "97% match" comes to mean
-- two incompatible things in the same column, and how a recruiter rejects
-- somebody on the strength of a number that never looked at their CV. So the
-- flag is NOT NULL with no default that could be forgotten: every score says
-- which kind it is, and the UI is required to say so too.
--
-- ── WHY THE HUMAN RATING IS NOT IN ai_breakdown ─────────────────────────────
--
-- An interviewer's stars and a model's estimate are evidence of different kinds,
-- and the whole value of the scorecard is that the two can DISAGREE. Averaging
-- them into one figure destroys exactly the signal a hiring manager needs. They
-- are therefore separate columns that the UI puts side by side and never adds up.
--
-- ── ON REJECTED CANDIDATES AND THE TALENT POOL ─────────────────────────────
--
-- No new table: `job_applicant.status = 'TALENT_POOL'` and the `talent_pool`
-- table from 0360 already exist. What was missing is the reason to go back —
-- skills, score and CV — which the columns below give the pool something to
-- search on. A candidate who was right but late is the cheapest hire available
-- next quarter, and until now nothing recorded enough about them to find them.
-- ============================================================================

-- ── 1. What the role asks for ──────────────────────────────────────────────

ALTER TABLE vacancy ADD COLUMN IF NOT EXISTS employment_type       text;
ALTER TABLE vacancy ADD COLUMN IF NOT EXISTS location              text;
ALTER TABLE vacancy ADD COLUMN IF NOT EXISTS experience_years_min  integer CHECK (experience_years_min >= 0);
ALTER TABLE vacancy ADD COLUMN IF NOT EXISTS skills_required       text[] NOT NULL DEFAULT '{}';
ALTER TABLE vacancy ADD COLUMN IF NOT EXISTS salary_min            numeric(18,2);
ALTER TABLE vacancy ADD COLUMN IF NOT EXISTS salary_max            numeric(18,2);
ALTER TABLE vacancy ADD COLUMN IF NOT EXISTS salary_currency       char(3);
ALTER TABLE vacancy ADD COLUMN IF NOT EXISTS closes_on             date;

-- A range that runs backwards silently mis-scores every applicant's salary fit
-- (the heuristic divides by the span), so it is refused rather than tolerated.
-- NOT VALID would let existing rows through unchecked — there are none with
-- these columns, since this migration is what creates them, so a plain
-- constraint is safe and is actually enforced from the first insert.
DO $$ BEGIN
  ALTER TABLE vacancy ADD CONSTRAINT ck_vacancy_salary_range
    CHECK (salary_min IS NULL OR salary_max IS NULL OR salary_max >= salary_min);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The public careers link. NULL until somebody publishes, which is what makes
-- "is this role public?" a fact about the row rather than a second boolean that
-- can disagree with it. Unguessable by construction: the token is generated
-- server-side and is the ONLY credential the apply endpoint accepts, so it must
-- never be derived from the vacancy_id, the title or anything else enumerable.
ALTER TABLE vacancy ADD COLUMN IF NOT EXISTS public_token  text UNIQUE;
ALTER TABLE vacancy ADD COLUMN IF NOT EXISTS published_at  timestamptz;

COMMENT ON COLUMN vacancy.public_token IS
  'Unguessable server-generated token for the public careers URL. NULL = not published. The only credential the unauthenticated apply endpoint accepts, so it must never be derived from any enumerable value.';

/* Custom scoring criteria — the "what else should the AI weigh?" the recruiter
 * adds on top of the structured fields. Weighted, because "must have customs
 * clearance experience" and "nice if they speak Portuguese" are not the same
 * question, and a flat list of criteria makes them so. */
CREATE TABLE IF NOT EXISTS vacancy_criterion (
  vacancy_criterion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id  uuid NOT NULL REFERENCES vacancy(vacancy_id) ON DELETE CASCADE,
  label       text NOT NULL CHECK (length(btrim(label)) > 0),
  -- Free text handed to the model: "count only clearance at a sea port".
  guidance    text,
  -- Relative, not a percentage: the scorer normalises across the row set, so
  -- weights need not sum to anything and adding a criterion cannot silently
  -- rescale the ones already there.
  weight      numeric(6,2) NOT NULL DEFAULT 1 CHECK (weight > 0),
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_vacancy_criterion_vacancy ON vacancy_criterion(vacancy_id);

-- ── 2. What the candidate brought ──────────────────────────────────────────

-- Self-reported at apply time. Kept DISTINCT from anything read out of the CV,
-- because the gap between the two is itself worth seeing.
ALTER TABLE job_applicant ADD COLUMN IF NOT EXISTS address          text;
ALTER TABLE job_applicant ADD COLUMN IF NOT EXISTS skills           text[] NOT NULL DEFAULT '{}';
ALTER TABLE job_applicant ADD COLUMN IF NOT EXISTS experience_years numeric(5,2) CHECK (experience_years >= 0);
ALTER TABLE job_applicant ADD COLUMN IF NOT EXISTS expected_salary  numeric(18,2) CHECK (expected_salary >= 0);
ALTER TABLE job_applicant ADD COLUMN IF NOT EXISTS portfolio_url    text;
ALTER TABLE job_applicant ADD COLUMN IF NOT EXISTS cover_note       text;
-- How they got here: 'careers' (the public page), 'referral', 'agency',
-- 'manual' (added by a recruiter). Free text on purpose — every company's
-- sourcing vocabulary differs, and an enum here would need a migration per
-- job board.
ALTER TABLE job_applicant ADD COLUMN IF NOT EXISTS source           text;
ALTER TABLE job_applicant ADD COLUMN IF NOT EXISTS applied_at       timestamptz;

-- Existing rows applied when they were created; leaving this NULL would make
-- every pre-0525 applicant sort last forever in a list ordered by applied_at.
UPDATE job_applicant SET applied_at = created_at WHERE applied_at IS NULL;
ALTER TABLE job_applicant ALTER COLUMN applied_at SET DEFAULT now();

-- ── 3. What the model thought ──────────────────────────────────────────────

ALTER TABLE job_applicant ADD COLUMN IF NOT EXISTS ai_score       integer CHECK (ai_score BETWEEN 0 AND 100);
-- Per-dimension: { skills: 100, experience: 100, salary_fit: 100, portfolio: 67,
-- criteria: [{ label, score, note }] }. jsonb rather than columns because the
-- dimensions are per-vacancy once custom criteria exist — a column per
-- dimension would be a migration every time a recruiter adds one.
ALTER TABLE job_applicant ADD COLUMN IF NOT EXISTS ai_breakdown   jsonb;
ALTER TABLE job_applicant ADD COLUMN IF NOT EXISTS ai_summary     text;
-- The column this migration exists for — see the header.
ALTER TABLE job_applicant ADD COLUMN IF NOT EXISTS ai_provisional boolean NOT NULL DEFAULT true;
ALTER TABLE job_applicant ADD COLUMN IF NOT EXISTS ai_scored_at   timestamptz;
-- Which model produced it. A score is only reproducible if you know what made
-- it, and provider/model changes are the single likeliest cause of "why did
-- this candidate's number move?"
ALTER TABLE job_applicant ADD COLUMN IF NOT EXISTS ai_model       text;

COMMENT ON COLUMN job_applicant.ai_provisional IS
  'TRUE = heuristic estimate from the fields the candidate typed; the CV has NOT been read. FALSE = a full model read of the résumé against the JD and criteria. Never render a score without this distinction — the two are not comparable.';

-- The interviewer's own verdict. 1..5 in halves, kept apart from ai_score on
-- purpose: the point of a scorecard is that a human may disagree with the model.
ALTER TABLE job_applicant ADD COLUMN IF NOT EXISTS rating numeric(2,1)
  CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5));

-- The recruiter's working list: "this vacancy, best first". Partial on
-- ai_score so the index stays small on a pipeline where most rows are unscored.
CREATE INDEX IF NOT EXISTS ix_job_applicant_vacancy_score
  ON job_applicant(vacancy_id, ai_score DESC) WHERE ai_score IS NOT NULL;
-- The talent-pool search: "who did we see before who might suit this?"
CREATE INDEX IF NOT EXISTS ix_job_applicant_pool
  ON job_applicant(status) WHERE status = 'TALENT_POOL';

-- ── 4. What a human thought ────────────────────────────────────────────────

/* Interview questions, generated per vacancy and then edited. Stored rather
 * than regenerated per interview so that two candidates for one role are asked
 * the SAME questions — which is the only thing that makes their scorecards
 * comparable, and is what a fair process requires. */
CREATE TABLE IF NOT EXISTS vacancy_question (
  vacancy_question_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id   uuid NOT NULL REFERENCES vacancy(vacancy_id) ON DELETE CASCADE,
  position     integer NOT NULL DEFAULT 0,
  question     text NOT NULL CHECK (length(btrim(question)) > 0),
  -- What a good answer sounds like. Shown to the interviewer, never to the
  -- candidate.
  rationale    text,
  ai_generated boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_vacancy_question_vacancy ON vacancy_question(vacancy_id, position);

/* One rating per (candidate, question). The overall `job_applicant.rating` is
 * the average of these — computed on read, not stored twice, so the two can
 * never disagree. */
CREATE TABLE IF NOT EXISTS applicant_answer (
  applicant_answer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id        uuid NOT NULL REFERENCES job_applicant(applicant_id) ON DELETE CASCADE,
  vacancy_question_id uuid NOT NULL REFERENCES vacancy_question(vacancy_question_id) ON DELETE CASCADE,
  rating              numeric(2,1) CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
  notes               text,
  rated_by            uuid REFERENCES app_user(user_id),
  rated_at            timestamptz NOT NULL DEFAULT now()
);
-- One row per pair: rating a question twice must UPDATE, not accumulate a
-- history that the average would then double-count.
CREATE UNIQUE INDEX IF NOT EXISTS ux_applicant_answer_pair
  ON applicant_answer(applicant_id, vacancy_question_id);

COMMENT ON TABLE applicant_answer IS
  'Per-question interview ratings. job_applicant.rating is the average of these and is written by the service on every upsert; nothing else should write it.';

-- DOWN
-- DROP TABLE IF EXISTS applicant_answer;
-- DROP TABLE IF EXISTS vacancy_question;
-- DROP TABLE IF EXISTS vacancy_criterion;
-- ALTER TABLE job_applicant
--   DROP COLUMN IF EXISTS rating, DROP COLUMN IF EXISTS ai_model,
--   DROP COLUMN IF EXISTS ai_scored_at, DROP COLUMN IF EXISTS ai_provisional,
--   DROP COLUMN IF EXISTS ai_summary, DROP COLUMN IF EXISTS ai_breakdown,
--   DROP COLUMN IF EXISTS ai_score, DROP COLUMN IF EXISTS applied_at,
--   DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS cover_note,
--   DROP COLUMN IF EXISTS portfolio_url, DROP COLUMN IF EXISTS expected_salary,
--   DROP COLUMN IF EXISTS experience_years, DROP COLUMN IF EXISTS skills,
--   DROP COLUMN IF EXISTS address;
-- ALTER TABLE vacancy
--   DROP CONSTRAINT IF EXISTS ck_vacancy_salary_range,
--   DROP COLUMN IF EXISTS published_at, DROP COLUMN IF EXISTS public_token,
--   DROP COLUMN IF EXISTS closes_on, DROP COLUMN IF EXISTS salary_currency,
--   DROP COLUMN IF EXISTS salary_max, DROP COLUMN IF EXISTS salary_min,
--   DROP COLUMN IF EXISTS skills_required, DROP COLUMN IF EXISTS experience_years_min,
--   DROP COLUMN IF EXISTS location, DROP COLUMN IF EXISTS employment_type;
--
-- DESTRUCTIVE, and in a way worth stating: dropping `public_token` breaks every
-- careers link already handed out — every candidate mid-application gets a 404
-- on a URL that worked yesterday, and re-publishing mints DIFFERENT tokens, so
-- the old links never come back. Dropping applicant_answer discards interview
-- scorecards, which are the human record of a hiring decision and may be the
-- evidence for one that is later challenged.
--
-- If the reason for the rollback is the SCORER rather than the schema, do not
-- run this: unset the AI provider and the scoring endpoints degrade to "not
-- configured" while every applicant, question and rating stays intact.
