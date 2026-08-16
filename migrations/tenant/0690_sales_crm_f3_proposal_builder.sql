-- TENANT DB — 0690 Sales & CRM F3: manual proposal builder.
-- Idempotent vertical slice: commercial terms and bilingual, re-draftable narratives.
ALTER TABLE proposal ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'BILINGUAL';
ALTER TABLE proposal ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'XAF';
ALTER TABLE proposal ADD COLUMN IF NOT EXISTS service_category text;
ALTER TABLE proposal ADD COLUMN IF NOT EXISTS incoterm text;
ALTER TABLE proposal ADD COLUMN IF NOT EXISTS origin_location text;
ALTER TABLE proposal ADD COLUMN IF NOT EXISTS destination_location text;
ALTER TABLE proposal ADD COLUMN IF NOT EXISTS cargo_description text;
ALTER TABLE proposal ADD COLUMN IF NOT EXISTS estimated_weight numeric(18,3);
ALTER TABLE proposal ADD COLUMN IF NOT EXISTS project_cargo_flag boolean NOT NULL DEFAULT false;
ALTER TABLE proposal ADD COLUMN IF NOT EXISTS customs_clearance_target text;
ALTER TABLE proposal ADD COLUMN IF NOT EXISTS transit_time_target text;
ALTER TABLE proposal ADD COLUMN IF NOT EXISTS free_days_demurrage integer;
ALTER TABLE proposal ADD COLUMN IF NOT EXISTS payment_conditions text;
ALTER TABLE proposal ADD COLUMN IF NOT EXISTS validity_days integer NOT NULL DEFAULT 30;
ALTER TABLE proposal ADD COLUMN IF NOT EXISTS converted_client_id uuid REFERENCES client_master(client_id);
ALTER TABLE proposal ADD COLUMN IF NOT EXISTS converted_quote_id uuid REFERENCES quotation(quotation_id);

ALTER TABLE proposal_narrative ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'EN';
ALTER TABLE proposal_narrative ADD COLUMN IF NOT EXISTS raw_client_operations text;
ALTER TABLE proposal_narrative ADD COLUMN IF NOT EXISTS raw_pain_points text;
ALTER TABLE proposal_narrative ADD COLUMN IF NOT EXISTS raw_proposed_strategy text;
ALTER TABLE proposal_narrative ADD COLUMN IF NOT EXISTS raw_tone text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_proposal_language') THEN
    ALTER TABLE proposal ADD CONSTRAINT ck_proposal_language CHECK (language IN ('EN','FR','BILINGUAL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_proposal_currency') THEN
    ALTER TABLE proposal ADD CONSTRAINT ck_proposal_currency CHECK (currency ~ '^[A-Z]{3}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_proposal_terms_nonnegative') THEN
    ALTER TABLE proposal ADD CONSTRAINT ck_proposal_terms_nonnegative CHECK
      ((estimated_weight IS NULL OR estimated_weight >= 0) AND
       (free_days_demurrage IS NULL OR free_days_demurrage >= 0) AND validity_days > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_proposal_narrative_language') THEN
    ALTER TABLE proposal_narrative ADD CONSTRAINT ck_proposal_narrative_language CHECK (language IN ('EN','FR'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_proposal_converted_quote ON proposal(converted_quote_id) WHERE converted_quote_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_proposal_narrative_section_language
  ON proposal_narrative(proposal_id, section, language);

-- DOWN (only after preserving proposal content)
-- DROP INDEX IF EXISTS ux_proposal_narrative_section_language;
-- DROP INDEX IF EXISTS ix_proposal_converted_quote;
