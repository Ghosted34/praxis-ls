-- ============================================================================
-- TENANT DB — 0683 Sales & CRM F6: Lead register + Quote intake + conversion.
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
-- The corporate entity the lead belongs to.
--
-- Not cosmetic. `client_master.create` allocates the client's own `CL-` ref
-- only when `entity_id` is present (client_master.service.js: `if (!ref &&
-- payload.entity_id)`), so a lead converted without one produced a client with
-- NO reference number — which Finance then has to complete by hand, the exact
-- outcome F6's definition of done rules out. It is also what lets the intake
-- register inherit an entity from the lead it was raised against.
ALTER TABLE lead ADD COLUMN IF NOT EXISTS entity_id uuid REFERENCES corporate_entity(entity_id);
CREATE INDEX IF NOT EXISTS ix_lead_entity ON lead(entity_id) WHERE entity_id IS NOT NULL;

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

-- ─── 4. The corporate entity a request belongs to ───────────────────────────
--
-- WHY THIS IS NOT OPTIONAL, AND WHY IT WAS MISSING.
--
-- `public_ref` is documented above as "allocated via numbering.service", and
-- numbering.service.allocate() REFUSES a null entity:
--
--     if (!entityId) throw new AppError("NO_ENTITY", "entityId is required for
--                                        numbering", 422);
--
-- because `doc_sequence` is keyed (module_key, year, entity_id) — a tenant that
-- trades through two corporate entities must not have one shared counter, or
-- SQ-2026-0007 exists twice and means two different enquiries. Without this
-- column there was nothing to pass, so every create raised a 422 before it
-- reached the insert and the register could not take a single row.
--
-- NULLABLE, resolved at write time. A tenant with exactly one active entity
-- should not be asked which one; the service resolves the default and stamps
-- it. A tenant with several gets asked, because there is no honest default.
ALTER TABLE quote_request ADD COLUMN IF NOT EXISTS entity_id uuid REFERENCES corporate_entity(entity_id);

CREATE INDEX IF NOT EXISTS ix_quote_request_entity
  ON quote_request(entity_id) WHERE entity_id IS NOT NULL;

-- ─── 5. The numbering scheme for the intake register ────────────────────────
--
-- Seeded as a tenant DEFAULT, not baked into the service (BUILD_CONVENTIONS
-- §6: "any numbering ... a module introduces must be seeded as a tenant
-- default, editable via Settings, and read at runtime from config").
-- `MOD-20-INTAKE` rather than `MOD-20`: the lead register and the intake
-- register are two different document families and must not share a counter.
--
-- ON CONFLICT DO NOTHING so a re-run never overwrites a tenant's own scheme.
INSERT INTO setting (section, key, value) VALUES
 ('numbering', 'MOD-20-INTAKE', '{"prefix":"SQ","code":"","padding":4,"reset":"yearly","separator":"-"}'::jsonb)
ON CONFLICT (section, key) DO NOTHING;

-- ─── 6. Intake grants ───────────────────────────────────────────────────────
--
-- The register rides MOD-20 (Leads) rather than claiming a catalogue key of its
-- own — an enquiry IS the front of the lead funnel, and splitting the grant
-- would mean a salesperson who can see leads cannot see the enquiry that
-- produced one. 9021 already grants MOD-20 to the commercial roles, so nothing
-- new is needed here; this comment exists so the absence is a decision on the
-- record rather than an oversight.

-- ─── 7. Event types for the intake lifecycle ────────────────────────────────
--
-- `event_log.event_type_key` carries no FK, so an unregistered key logs happily
-- and is then invisible to the workflow designer and the notification rules —
-- which is worse than a failure, because nothing reports it. Every key this
-- module emits is declared here so a tenant can bind an approval or an alert to
-- it, exactly as 9030 does for the modules that shipped before it.
INSERT INTO event_type (key, module_key, name, is_security_critical, is_approvable) VALUES
 ('quote_request.created',                  'MOD-20','Quote request received',            false,false),
 ('quote_request.updated',                  'MOD-20','Quote request updated',             false,false),
 ('quote_request.under_review',             'MOD-20','Quote request under review',        false,false),
 ('quote_request.clarification_required',   'MOD-20','Quote request needs clarification', false,false),
 ('quote_request.quoted',                   'MOD-20','Quote request quoted',              false,false),
 ('quote_request.closed_no_action',         'MOD-20','Quote request closed, no action',   false,false),
 ('quote_request.converted',                'MOD-20','Quote request converted to opportunity', false,true),
 ('quote_request.attachment_added',         'MOD-20','Quote request attachment added',    false,false),
 ('quote_request.attachment_removed',       'MOD-20','Quote request attachment removed',  false,false)
ON CONFLICT (key) DO NOTHING;

-- DOWN
-- Order matters: the attachment table references quote_request, and the trigger
-- functions are referenced by the triggers.
--
-- READ BEFORE RUNNING — quote_request holds captured client enquiries that
-- exist nowhere else (the website posts into it; there is no second copy):
--   SELECT COUNT(*) FROM quote_request;
--   SELECT COUNT(*) FROM quote_request_attachment;
-- The lead columns are additive and safe to drop; the two tables are not.
--
-- DROP INDEX IF EXISTS ix_quote_request_attachment_request;
-- DROP TABLE IF EXISTS quote_request_attachment;
-- DROP TRIGGER IF EXISTS trg_quote_request_updated ON quote_request;
-- DROP TRIGGER IF EXISTS trg_quote_request_sync_converted ON quote_request;
-- DROP FUNCTION IF EXISTS quote_request_sync_converted();
-- DROP INDEX IF EXISTS ix_quote_request_entity;
-- DROP INDEX IF EXISTS ix_quote_request_converted_opp;
-- DROP INDEX IF EXISTS ix_quote_request_created_at;
-- DROP INDEX IF EXISTS ix_quote_request_service_category;
-- DROP INDEX IF EXISTS ix_quote_request_channel;
-- DROP INDEX IF EXISTS ix_quote_request_lead;
-- DROP INDEX IF EXISTS ix_quote_request_status;
-- DROP TABLE IF EXISTS quote_request;
-- DELETE FROM setting WHERE section = 'numbering' AND key = 'MOD-20-INTAKE';
--
-- DROP INDEX IF EXISTS ix_lead_intake_channel;
-- DROP INDEX IF EXISTS ix_lead_country;
-- DROP INDEX IF EXISTS ux_lead_public_ref;
-- ALTER TABLE lead DROP CONSTRAINT IF EXISTS ck_lead_client_type_hint;
-- ALTER TABLE lead DROP CONSTRAINT IF EXISTS ck_lead_intake_channel;
-- DROP INDEX IF EXISTS ix_lead_entity;
-- ALTER TABLE lead DROP COLUMN IF EXISTS entity_id;
-- ALTER TABLE lead DROP COLUMN IF EXISTS public_ref;
-- ALTER TABLE lead DROP COLUMN IF EXISTS payment_terms_days;
-- ALTER TABLE lead DROP COLUMN IF EXISTS client_type_hint;
-- ALTER TABLE lead DROP COLUMN IF EXISTS intake_channel;
-- ALTER TABLE lead DROP COLUMN IF EXISTS rccm;
-- ALTER TABLE lead DROP COLUMN IF EXISTS niu;
-- ALTER TABLE lead DROP COLUMN IF EXISTS address;
-- ALTER TABLE lead DROP COLUMN IF EXISTS country;
