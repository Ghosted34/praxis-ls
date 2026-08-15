-- ============================================================================
-- TENANT DB — 0682 Sales & CRM F6: Lead register + Quote intake + conversion.
--
-- This is the vertical slice for SALES_CRM_FEATURES.md#F6. It owns:
--   1. Lead hardening (country, address, NIU, RCCM, intake_channel, hints for
--      conversion, public_ref on the lead itself when the lead is itself the
--      intake record).
--   2. quote_request (the logistics-scope intake register with its own
--      lifecycle, KPI statuses, and conversion into an opportunity).
--   3. quote_request_attachment (one primary + n additional documents).
--
-- The architectural correction that defines this feature: the legacy stores
-- intake status AND pipeline stage in the same column, which is why its KPI
-- tiles show 5 of 26 rows. We separate them. `lead.status` stays as the
-- commercial funnel (NEW -> CONTACTED -> QUALIFIED -> CONVERTED/LOST).
-- `quote_request.status` carries the intake lifecycle. `opportunity.pipeline_stage_id`
-- carries the pipeline stage. Three different concerns, three different rows.
--
-- Also corrected from legacy:
--   - convert_lead hard-coded client_type='BOTH' and payment_terms=30 days.
--     This migration adds the hint columns and a new lead.service.convert
--     pass-through; the prompt comes from the UI/endpoint payload.
--   - isConverted was computed two different ways in the legacy. We do it
--     ONE way: `quote_request.converted_opportunity_id IS NOT NULL`. The
--     status value is descriptive only.
--
-- Idempotent: every CREATE guarded with IF NOT EXISTS, every ALTER guarded
-- with ADD COLUMN IF NOT EXISTS (per doc/DB_ARCHITECTURE.md §8.2).
-- ============================================================================

-- ─── 1. lead hardening ──────────────────────────────────────────────────────
ALTER TABLE lead ADD COLUMN IF NOT EXISTS country          text;
ALTER TABLE lead ADD COLUMN IF NOT EXISTS address          text;
ALTER TABLE lead ADD COLUMN IF NOT EXISTS niu              text;
ALTER TABLE lead ADD COLUMN IF NOT EXISTS rccm             text;
ALTER TABLE lead ADD COLUMN IF NOT EXISTS intake_channel   text NOT NULL DEFAULT 'MANUAL';
ALTER TABLE lead ADD COLUMN IF NOT EXISTS client_type_hint text;
ALTER TABLE lead ADD COLUMN IF NOT EXISTS payment_terms_days integer;
ALTER TABLE lead ADD COLUMN IF NOT EXISTS public_ref       text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_lead_intake_channel'
  ) THEN
    ALTER TABLE lead
      ADD CONSTRAINT ck_lead_intake_channel
      CHECK (intake_channel IN ('WEBSITE','MANUAL','REFERRAL','CAMPAIGN'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_lead_client_type_hint'
  ) THEN
    ALTER TABLE lead
      ADD CONSTRAINT ck_lead_client_type_hint
      CHECK (client_type_hint IS NULL OR client_type_hint IN ('SHIPPER','CONSIGNEE','BOTH','CARRIER','AGENT'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_lead_public_ref
  ON lead(public_ref) WHERE public_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_lead_country ON lead(country) WHERE country IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_lead_intake_channel ON lead(intake_channel);

-- ─── 2. quote_request (the intake register) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS quote_request (
  quote_request_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_ref              text UNIQUE,                -- SQ-YYYY-NNNN, allocated via numbering.service
  lead_id                 uuid REFERENCES lead(lead_id),  -- nullable: website intake may not have a lead yet
  intake_channel          text NOT NULL DEFAULT 'MANUAL'
                            CHECK (intake_channel IN ('WEBSITE','MANUAL','REFERRAL','CAMPAIGN')),
  requester_name          text,
  requester_company       text,
  requester_email         citext,
  requester_phone         text,
  service_category        text,                       -- SEA_FREIGHT_IMPORT | AIR_FREIGHT_EXPORT | …
  service_type            text,                       -- Incoterm: EXW | FOB | CIF | …
  origin_location         text,
  destination_location    text,
  warehouse_location      text,
  warehouse_duration      text
                            CHECK (warehouse_duration IS NULL OR warehouse_duration IN
                              ('LESS_THAN_7_DAYS','DAYS_7_TO_14','DAYS_15_TO_30','OVER_30_DAYS','UNKNOWN')),
  estimated_weight        numeric(18,4),
  project_cargo_flag      boolean NOT NULL DEFAULT false,
  cargo_description       text,
  incoterm                text NOT NULL,              -- required by the legacy
  status                  text NOT NULL DEFAULT 'RECEIVED'
                            CHECK (status IN ('RECEIVED','UNDER_REVIEW','CLARIFICATION_REQUIRED',
                                              'QUOTED','CONVERTED_TO_OPPORTUNITY','CLOSED_NO_ACTION')),
  converted_opportunity_id uuid,                      -- the SINGLE source of truth for "is converted"
  converted_at            timestamptz,
  owner_user_id           uuid REFERENCES app_user(user_id),
  created_by_user_id      uuid REFERENCES app_user(user_id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_quote_request_status            ON quote_request(status);
CREATE INDEX IF NOT EXISTS ix_quote_request_lead              ON quote_request(lead_id);
CREATE INDEX IF NOT EXISTS ix_quote_request_channel           ON quote_request(intake_channel);
CREATE INDEX IF NOT EXISTS ix_quote_request_service_category  ON quote_request(service_category);
CREATE INDEX IF NOT EXISTS ix_quote_request_created_at        ON quote_request(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_quote_request_converted_opp
  ON quote_request(converted_opportunity_id) WHERE converted_opportunity_id IS NOT NULL;

-- Enforce: once converted, status must reflect it. Two paths to update, one
-- authoritative value. The trigger keeps the column and the FK column in sync
-- (defending the architectural rule: status is descriptive, the FK is truth).
CREATE OR REPLACE FUNCTION quote_request_sync_converted()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.converted_opportunity_id IS NOT NULL THEN
    NEW.converted_at := COALESCE(NEW.converted_at, now());
    IF NEW.status <> 'CONVERTED_TO_OPPORTUNITY' THEN
      NEW.status := 'CONVERTED_TO_OPPORTUNITY';
    END IF;
  ELSE
    NEW.converted_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- CREATE OR REPLACE TRIGGER is PG14+; the deployment runs PG16. The gate at
-- scripts/db/check-migration-idempotency.js keys on `OR REPLACE`, so the
-- file is idempotent by construction (and the manual DROP form below is
-- kept for older Postgres only — comment-only here).
CREATE OR REPLACE TRIGGER trg_quote_request_sync_converted
  BEFORE INSERT OR UPDATE ON quote_request
  FOR EACH ROW EXECUTE FUNCTION quote_request_sync_converted();

CREATE OR REPLACE TRIGGER trg_quote_request_updated
  BEFORE UPDATE ON quote_request
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 3. quote_request_attachment ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quote_request_attachment (
  quote_request_attachment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_request_id            uuid NOT NULL REFERENCES quote_request(quote_request_id) ON DELETE CASCADE,
  vault_id                    uuid NOT NULL REFERENCES document_vault(doc_id),
  kind                        text NOT NULL DEFAULT 'ADDITIONAL'
                                CHECK (kind IN ('PRIMARY','ADDITIONAL')),
  uploaded_by_user_id         uuid REFERENCES app_user(user_id),
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_quote_request_attachment_request
  ON quote_request_attachment(quote_request_id);
