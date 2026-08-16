-- 0691 Sales CRM F2 — tenant-owned, structured company fact sheet.
CREATE TABLE IF NOT EXISTS company_profile (
  company_profile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  slogan text, positioning text, operating_regions text[] NOT NULL DEFAULT '{}',
  gateways text[] NOT NULL DEFAULT '{}', memberships text[] NOT NULL DEFAULT '{}',
  certifications text[] NOT NULL DEFAULT '{}', service_promises jsonb NOT NULL DEFAULT '[]',
  source_document_id uuid REFERENCES document_vault(doc_id),
  declared_confirmed_at timestamptz, declared_confirmed_by uuid REFERENCES app_user(user_id),
  fleet_count integer NOT NULL DEFAULT 0, fleet_composition jsonb NOT NULL DEFAULT '{}',
  warehouse_capacity numeric(18,2) NOT NULL DEFAULT 0, top_lanes jsonb NOT NULL DEFAULT '[]',
  vertical_mix jsonb NOT NULL DEFAULT '[]', average_clearance_hours numeric(18,2),
  client_count integer NOT NULL DEFAULT 0, turnover_band text,
  computed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS company_profile_project (
  company_profile_project_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_profile_id uuid NOT NULL REFERENCES company_profile(company_profile_id) ON DELETE CASCADE,
  name_en text NOT NULL, name_fr text, description_en text, description_fr text,
  metrics jsonb NOT NULL DEFAULT '{}', sort_order integer NOT NULL DEFAULT 0
);
ALTER TABLE client_master ADD COLUMN IF NOT EXISTS public_reference_consent text NOT NULL DEFAULT 'NOT_ASKED';
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_client_public_reference_consent') THEN
 ALTER TABLE client_master ADD CONSTRAINT ck_client_public_reference_consent CHECK (public_reference_consent IN ('NOT_ASKED','ANONYMISED_ONLY','NAMED'));
END IF; END $$;
CREATE INDEX IF NOT EXISTS ix_company_profile_project_profile ON company_profile_project(company_profile_id, sort_order);
INSERT INTO company_profile(singleton) VALUES(true) ON CONFLICT(singleton) DO NOTHING;

-- DOWN (preserve a JSON export of declared facts and projects first)
-- DROP INDEX IF EXISTS ix_company_profile_project_profile;
-- ALTER TABLE client_master DROP CONSTRAINT IF EXISTS ck_client_public_reference_consent;
-- ALTER TABLE client_master DROP COLUMN IF EXISTS public_reference_consent;
-- DROP TABLE IF EXISTS company_profile_project;
-- DROP TABLE IF EXISTS company_profile;
