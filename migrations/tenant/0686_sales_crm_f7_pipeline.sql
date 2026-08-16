-- ============================================================================
-- TENANT DB — 0686 Sales & CRM F7: the sales pipeline board.
--
-- Vertical slice for doc/SALES_CRM_FEATURES.md#F7. It owns:
--   1. pipeline_stage.default_probability — the win probability the legacy
--      carries in STAGE_CONFIG (sales-pipelining.php line 515) and this
--      system had nowhere to put.
--   2. The SEVENTH stage. migrations/seeds/9030 seeds six; the legacy
--      permits seven (api/sales_pipeline/_common.php line 26). The missing
--      one is PRICING_IN_PROGRESS — "with the margin simulator", the handoff
--      from sales to commercial pricing, at 50%. It is not decorative: the
--      live system has records sitting in it right now.
--   3. opportunity.source / source_ref / scope_summary — the card fields the
--      legacy board renders (list.php lines 40-48) and this schema lacks.
--   4. opportunity.probability_is_manual — see below.
--   5. opportunity.settled_at — when the deal stopped being open, so win rate
--      can be computed over a period rather than over all history.
--
-- WHY 9030 IS NOT EDITED. `scripts/db/check-migration-idempotency.js` baselines
-- every applied migration by hash (seeds/9030 is in
-- scripts/db/migration-idempotency-baseline.json). Editing a seed that has
-- already run changes what a FRESH database gets and not what an existing one
-- has, and IF NOT EXISTS / ON CONFLICT guarantees nobody finds out. The seventh
-- stage therefore lands here, where it reaches existing tenants and new ones
-- alike.
--
-- WHY probability_is_manual EXISTS. Deriving probability from the stage is the
-- whole point of stage probabilities — but a salesperson who types "15%" on a
-- deal they know is soft must not have it silently reset to 70 by the next
-- stage move. One boolean records which of the two owns the number. Without it
-- the choice is between never deriving (the current state: probability is
-- always hand-typed) and clobbering a human judgement, and both are wrong.
--
-- STAGE ORDERING IS TENANT-TUNABLE (BUILD_CONVENTIONS §6), so this migration
-- inserts the missing stage RELATIVE to what the tenant has: it opens a gap at
-- sort_order 2 by shifting everything at or after it, rather than rewriting the
-- six seeded values. Probabilities backfill only where NULL, so a tenant that
-- has already tuned one keeps it.
--
-- Idempotent: every ALTER guarded with IF NOT EXISTS, every constraint inside a
-- DO block checking pg_constraint, every INSERT with ON CONFLICT, and the
-- stage-shift guarded on the absence of PRICING_IN_PROGRESS so re-running it
-- does not open a second gap (doc/DB_ARCHITECTURE.md §8.2).
-- ============================================================================

-- ─── 1. pipeline_stage: the win probability ─────────────────────────────────
ALTER TABLE pipeline_stage ADD COLUMN IF NOT EXISTS default_probability numeric(5,2);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_pipeline_stage_default_probability') THEN
    ALTER TABLE pipeline_stage
      ADD CONSTRAINT ck_pipeline_stage_default_probability
      CHECK (default_probability IS NULL OR (default_probability >= 0 AND default_probability <= 100));
  END IF;
END $$;

-- ─── 2. The seventh stage ───────────────────────────────────────────────────
-- Legacy STAGE_CONFIG (sales-pipelining.php ~515):
--   NEW 10 · QUALIFIED 30 · PRICING_IN_PROGRESS 50 · QUOTATION_SENT 70 · WON 100 · LOST 0
-- This system's PROPOSAL is the legacy's QUOTATION_SENT — same meaning, the
-- name this repo already uses, so it is not renamed. NEGOTIATION is this
-- system's own stage and the legacy assigns it no probability (its STAGES
-- const omits NEGOTIATION even though _common.php permits it); 85 is the
-- decision taken here — between quote sent and won — and it is a tenant-tunable
-- default, not a constant in code.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pipeline_stage WHERE code = 'PRICING_IN_PROGRESS') THEN
    -- Open the gap first, then fill it. Running these as one statement each,
    -- guarded by the absence of the stage, is what keeps the file rerunnable:
    -- a second run finds the stage and shifts nothing.
    UPDATE pipeline_stage SET sort_order = sort_order + 1 WHERE sort_order >= 2;
    INSERT INTO pipeline_stage (code, name, sort_order, is_won, is_lost, default_probability)
    VALUES ('PRICING_IN_PROGRESS', 'Pricing', 2, false, false, 50)
    ON CONFLICT (code) DO NOTHING;
  END IF;
END $$;

-- Backfill probabilities only where the tenant has not set one.
UPDATE pipeline_stage SET default_probability =  10 WHERE code = 'NEW'                 AND default_probability IS NULL;
UPDATE pipeline_stage SET default_probability =  30 WHERE code = 'QUALIFIED'           AND default_probability IS NULL;
UPDATE pipeline_stage SET default_probability =  50 WHERE code = 'PRICING_IN_PROGRESS' AND default_probability IS NULL;
UPDATE pipeline_stage SET default_probability =  70 WHERE code = 'PROPOSAL'            AND default_probability IS NULL;
UPDATE pipeline_stage SET default_probability =  85 WHERE code = 'NEGOTIATION'         AND default_probability IS NULL;
UPDATE pipeline_stage SET default_probability = 100 WHERE code = 'WON'                 AND default_probability IS NULL;
UPDATE pipeline_stage SET default_probability =   0 WHERE code = 'LOST'                AND default_probability IS NULL;

-- A won stage is 100 and a lost stage is 0 by definition — not a tunable.
UPDATE pipeline_stage SET default_probability = 100 WHERE is_won  = true AND COALESCE(default_probability, -1) <> 100;
UPDATE pipeline_stage SET default_probability =   0 WHERE is_lost = true AND COALESCE(default_probability, -1) <>   0;

-- ─── 3. opportunity: the card fields ────────────────────────────────────────
ALTER TABLE opportunity ADD COLUMN IF NOT EXISTS source               text NOT NULL DEFAULT 'MANUAL';
ALTER TABLE opportunity ADD COLUMN IF NOT EXISTS source_ref           text;
ALTER TABLE opportunity ADD COLUMN IF NOT EXISTS scope_summary        text;
ALTER TABLE opportunity ADD COLUMN IF NOT EXISTS probability_is_manual boolean NOT NULL DEFAULT false;
ALTER TABLE opportunity ADD COLUMN IF NOT EXISTS settled_at           timestamptz;

-- The source vocabulary is the lead/quote_request intake_channel set (0683)
-- plus the two in-system origins a deal can have. It is deliberately the SAME
-- vocabulary: an opportunity that came from a website quote request should
-- report the same channel the request did, not a parallel spelling of it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_opportunity_source') THEN
    ALTER TABLE opportunity
      ADD CONSTRAINT ck_opportunity_source
      CHECK (source IN ('WEBSITE','MANUAL','REFERRAL','CAMPAIGN','QUOTE_REQUEST','LEAD_CONVERSION','PARTNER','OTHER'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_opportunity_status      ON opportunity(status);
CREATE INDEX IF NOT EXISTS ix_opportunity_stage       ON opportunity(pipeline_stage_id);
CREATE INDEX IF NOT EXISTS ix_opportunity_owner       ON opportunity(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_opportunity_source      ON opportunity(source);
CREATE INDEX IF NOT EXISTS ix_opportunity_created_at  ON opportunity(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_opportunity_settled_at  ON opportunity(settled_at DESC) WHERE settled_at IS NOT NULL;

-- ─── 4. settled_at is derived, never posted ─────────────────────────────────
-- The win-rate denominator has to be able to say "in Q2", and a status column
-- alone cannot: updated_at moves for any edit. This stamps the moment the deal
-- stopped being OPEN, in the database, so it is right no matter which of the
-- three code paths (move to a won/lost stage, win, lose) settled it.
CREATE OR REPLACE FUNCTION opportunity_sync_settled()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status <> 'OPEN' THEN
    NEW.settled_at := COALESCE(NEW.settled_at, now());
  ELSE
    NEW.settled_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_opportunity_sync_settled
  BEFORE INSERT OR UPDATE ON opportunity
  FOR EACH ROW EXECUTE FUNCTION opportunity_sync_settled();

CREATE OR REPLACE TRIGGER trg_opportunity_updated
  BEFORE UPDATE ON opportunity
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Backfill for rows settled before this migration: the best available
-- approximation is updated_at, and it is marked as such by being no better than
-- that. Only rows that are already settled are touched.
UPDATE opportunity SET settled_at = updated_at WHERE status <> 'OPEN' AND settled_at IS NULL;

-- ─── 5. Event types for the notification / workflow designer ────────────────
-- 9030 seeds only `opportunity.won`; the module has emitted the other three
-- since it was written, so the designer has been listing three fewer events
-- than the system produces.
INSERT INTO event_type (key, module_key, name, is_security_critical, is_approvable) VALUES
 ('opportunity.created',     'MOD-24', 'Opportunity created',      false, false),
 ('opportunity.updated',     'MOD-24', 'Opportunity updated',      false, false),
 ('opportunity.lost',        'MOD-24', 'Opportunity lost',         false, false),
 ('opportunity.stage_moved', 'MOD-24', 'Opportunity stage moved',  false, false)
ON CONFLICT (key) DO NOTHING;

-- ─── 6. A converted deal carries the request's channel ──────────────────────
-- The legacy board reads `source` and `scope` off the ORIGINATING quote request
-- (api/sales_pipeline/list.php lines 40-48). Here the opportunity is its own
-- row, so the two have to be kept in step — and the honest place for that is
-- the database, not the one JS call site that happens to do conversions today:
-- `quote_request.converted_opportunity_id` is already the single source of
-- truth for "is converted" (0683), and F6 already keeps status in sync with it
-- by trigger. This is the same invariant, one column further on.
--
-- The `source = 'MANUAL'` guard is what makes it safe: a deal whose origin was
-- stated explicitly is never overwritten, and the default is only filled in
-- once. Same reason source_ref and scope_summary use COALESCE.
CREATE OR REPLACE FUNCTION opportunity_inherit_intake_source()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.converted_opportunity_id IS NOT NULL THEN
    UPDATE opportunity o
       SET source        = 'QUOTE_REQUEST',
           source_ref    = COALESCE(o.source_ref, NEW.public_ref),
           scope_summary = COALESCE(o.scope_summary, NEW.cargo_description)
     WHERE o.opportunity_id = NEW.converted_opportunity_id
       AND o.source = 'MANUAL';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_quote_request_stamp_opportunity_source
  AFTER INSERT OR UPDATE OF converted_opportunity_id ON quote_request
  FOR EACH ROW EXECUTE FUNCTION opportunity_inherit_intake_source();

-- Backfill deals converted before this migration existed.
UPDATE opportunity o
   SET source        = 'QUOTE_REQUEST',
       source_ref    = COALESCE(o.source_ref, q.public_ref),
       scope_summary = COALESCE(o.scope_summary, q.cargo_description)
  FROM quote_request q
 WHERE q.converted_opportunity_id = o.opportunity_id
   AND o.source = 'MANUAL';

-- ─── 7. A deal with no stage is in the pipeline and on no board column ──────
-- opportunity.service.create already resolves the first open stage, and does it
-- in JS so the decision is visible and testable. The trigger is what makes the
-- invariant true for every OTHER writer — the conversion path inserts through
-- opportunity.repo directly rather than through the service, and a future
-- feature will do something else again. `pipeline_stage_id IS NULL` on an OPEN
-- deal is not a state the board can render, so it is not a state the table
-- accepts. RETURNING * runs after the BEFORE trigger, so a caller that skipped
-- the service still gets the resolved stage back in the row it inserted.
CREATE OR REPLACE FUNCTION opportunity_default_stage()
RETURNS TRIGGER AS $$
DECLARE
  s RECORD;
BEGIN
  IF NEW.pipeline_stage_id IS NULL THEN
    SELECT pipeline_stage_id, default_probability INTO s
      FROM pipeline_stage WHERE is_won = false AND is_lost = false
      ORDER BY sort_order LIMIT 1;
    IF FOUND THEN
      NEW.pipeline_stage_id := s.pipeline_stage_id;
      IF NEW.probability IS NULL AND NEW.probability_is_manual IS NOT TRUE THEN
        NEW.probability := s.default_probability;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_opportunity_default_stage
  BEFORE INSERT ON opportunity
  FOR EACH ROW EXECUTE FUNCTION opportunity_default_stage();

-- Existing stageless open deals join the board at its first column.
UPDATE opportunity o
   SET pipeline_stage_id = (SELECT pipeline_stage_id FROM pipeline_stage
                             WHERE is_won = false AND is_lost = false
                             ORDER BY sort_order LIMIT 1)
 WHERE o.pipeline_stage_id IS NULL
   AND o.status = 'OPEN';

-- DOWN
--
-- READ FIRST. Two statements in this migration WROTE TO EXISTING ROWS, and a
-- down section cannot put them back:
--
--   * the UPDATE above moved every stageless OPEN opportunity onto the board's
--     first column. Which rows had no stage beforehand is not recorded
--     anywhere, so re-running the reverse would strip a stage somebody has
--     since set deliberately.
--   * `opportunity.settled_at` is backfilled and then maintained by
--     trg_opportunity_sync_settled; dropping the column discards the settlement
--     timestamps.
--
-- So: the DDL below is reversible and the DATA is not. If a rollback is needed
-- after this has been live, restore the pre-deploy dump (scripts/deploy.sh
-- takes one) rather than running these. Check what would be lost first:
--   SELECT COUNT(*) FROM opportunity WHERE settled_at IS NOT NULL;
--   SELECT COUNT(*) FROM opportunity WHERE source <> 'MANUAL';
--   SELECT COUNT(*) FROM pipeline_stage WHERE code = 'PRICING_IN_PROGRESS';
--
-- PRICING_IN_PROGRESS is the stage the legacy has and this system lacked; it
-- means "with the margin simulator". Removing it strands any opportunity
-- sitting in it, which is why the DELETE below is guarded on there being none.
--
-- DROP TRIGGER IF EXISTS trg_opportunity_default_stage ON opportunity;
-- DROP FUNCTION IF EXISTS opportunity_default_stage();
-- DROP TRIGGER IF EXISTS trg_quote_request_stamp_opportunity_source ON quote_request;
-- DROP FUNCTION IF EXISTS opportunity_inherit_intake_source();
-- DROP TRIGGER IF EXISTS trg_opportunity_updated ON opportunity;
-- DROP TRIGGER IF EXISTS trg_opportunity_sync_settled ON opportunity;
-- DROP FUNCTION IF EXISTS opportunity_sync_settled();
--
-- DROP INDEX IF EXISTS ix_opportunity_settled_at;
-- DROP INDEX IF EXISTS ix_opportunity_created_at;
-- DROP INDEX IF EXISTS ix_opportunity_source;
-- DROP INDEX IF EXISTS ix_opportunity_owner;
-- DROP INDEX IF EXISTS ix_opportunity_stage;
-- DROP INDEX IF EXISTS ix_opportunity_status;
--
-- ALTER TABLE opportunity DROP COLUMN IF EXISTS settled_at;
-- ALTER TABLE opportunity DROP COLUMN IF EXISTS probability_is_manual;
-- ALTER TABLE opportunity DROP COLUMN IF EXISTS scope_summary;
-- ALTER TABLE opportunity DROP COLUMN IF EXISTS source_ref;
-- ALTER TABLE opportunity DROP COLUMN IF EXISTS source;
--
-- DELETE FROM pipeline_stage WHERE code = 'PRICING_IN_PROGRESS'
--   AND NOT EXISTS (SELECT 1 FROM opportunity o
--                    WHERE o.pipeline_stage_id = pipeline_stage.pipeline_stage_id);
-- ALTER TABLE pipeline_stage DROP COLUMN IF EXISTS default_probability;
--
-- DELETE FROM event_type WHERE key LIKE 'opportunity.%' AND module_key = 'MOD-24';
