-- 0693 Sales CRM F4 — persist the closed fact citations behind generated claims.
ALTER TABLE proposal_narrative ADD COLUMN IF NOT EXISTS fact_ids text[] NOT NULL DEFAULT '{}';
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_proposal_narrative_fact_ids') THEN ALTER TABLE proposal_narrative ADD CONSTRAINT ck_proposal_narrative_fact_ids CHECK (cardinality(fact_ids)=0 OR array_to_string(fact_ids, ',') ~ '^F[1-9][0-9]*(,F[1-9][0-9]*)*$'); END IF; END $$;
-- DOWN
-- ALTER TABLE proposal_narrative DROP CONSTRAINT IF EXISTS ck_proposal_narrative_fact_ids;
-- ALTER TABLE proposal_narrative DROP COLUMN IF EXISTS fact_ids;
