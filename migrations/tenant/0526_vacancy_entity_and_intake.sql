-- ============================================================================
-- TENANT DB — 0526 vacancies belong to a corporate entity, and remember their brief
--
-- ── WHY entity_id ──────────────────────────────────────────────────────────
--
-- 0525 gave a vacancy a salary band and a location but no answer to "who is
-- hiring?" — and in this product that is never rhetorical. A tenant runs
-- several corporate entities (0515: trading_name, legal_form, industry,
-- headcount, payroll_country, default_currency), an employee already carries
-- `entity_id`, and so does a work_site. A vacancy that does not is the one link
-- in the chain from advert to hire that loses the thread: the hire it provisions
-- lands on an employee row whose entity has to be guessed.
--
-- It also decides three things the recruiter should not have to retype:
--   * the CURRENCY of the salary band (entity.default_currency),
--   * the COUNTRY whose employment norms the draft should assume
--     (entity.payroll_country),
--   * and what the AI is told the company actually does.
--
-- NULLABLE, because a single-entity tenant should not be made to answer a
-- question that has one possible answer; the service falls back to the sole
-- active entity.
--
-- ── WHY intake_json ────────────────────────────────────────────────────────
--
-- The vacancy is DRAFTED from an interview: a recruiter answers a short series
-- of questions (typed or spoken) and the model writes the job description,
-- infers the department, the employment type and a market-shaped salary band.
--
-- Keeping the answers means the draft is reproducible and re-runnable. Without
-- them, "regenerate this description" would mean re-interviewing the person,
-- and the only record of WHY the model said what it said would be the prose it
-- produced. jsonb rather than columns because the question set is not fixed —
-- the later questions are generated from the earlier answers, so no column list
-- could describe it.
--
-- ── WHY ai_provider ────────────────────────────────────────────────────────
--
-- Which model wrote this, or `template` when none was reachable. The drafting
-- path deliberately NEVER fails — it falls back to a deterministic template so
-- the editor always opens with real content — and without this column a
-- template draft is indistinguishable from a model one, which is exactly the
-- moment somebody publishes boilerplate believing an AI wrote it.
-- ============================================================================

ALTER TABLE vacancy ADD COLUMN IF NOT EXISTS entity_id uuid REFERENCES corporate_entity(entity_id);
ALTER TABLE vacancy ADD COLUMN IF NOT EXISTS intake_json jsonb;
ALTER TABLE vacancy ADD COLUMN IF NOT EXISTS ai_provider text;
-- How many people this opening is for. The wizard asks; the careers page says
-- so, because "8 positions" and "1 position" attract differently.
ALTER TABLE vacancy ADD COLUMN IF NOT EXISTS headcount integer NOT NULL DEFAULT 1 CHECK (headcount > 0);

COMMENT ON COLUMN vacancy.intake_json IS
  'The answers the recruiter gave the drafting wizard, verbatim. Kept so a draft can be regenerated without re-interviewing anybody. Shape is deliberately open: the later questions are generated from the earlier answers.';
COMMENT ON COLUMN vacancy.ai_provider IS
  'Which model drafted this vacancy, or ''template'' when no AI vendor was reachable. Never NULL for an AI-drafted row — a template draft that looks model-written is how boilerplate gets published.';

-- "What is this entity hiring for?" — the list screen's filter.
CREATE INDEX IF NOT EXISTS ix_vacancy_entity ON vacancy(entity_id) WHERE entity_id IS NOT NULL;

-- DOWN
-- DROP INDEX IF EXISTS ix_vacancy_entity;
-- ALTER TABLE vacancy
--   DROP COLUMN IF EXISTS headcount,
--   DROP COLUMN IF EXISTS ai_provider,
--   DROP COLUMN IF EXISTS intake_json,
--   DROP COLUMN IF EXISTS entity_id;
--
-- Additive only, so the undo touches nothing that existed before it. What it
-- discards is the interview behind every drafted vacancy — recoverable only by
-- asking the recruiter the questions again — and the entity link, after which
-- a hire provisioned from a vacancy lands on an employee row with no entity.
