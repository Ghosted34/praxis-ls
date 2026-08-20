-- ============================================================================
-- TENANT DB — 10742 Per-party preferred language (PR-2, addition d).
--
-- One column, one helper. Signatures, templates and (in PR-4) AI translation
-- all resolve language through `resolveLanguage()` — three copies of this rule
-- is how a French client starts receiving English invoices.
-- ============================================================================

ALTER TABLE client_master
  ADD COLUMN IF NOT EXISTS preferred_language text;
ALTER TABLE supplier_master
  ADD COLUMN IF NOT EXISTS preferred_language text;
ALTER TABLE lead
  ADD COLUMN IF NOT EXISTS preferred_language text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_client_preferred_language'
  ) THEN
    ALTER TABLE client_master
      ADD CONSTRAINT ck_client_preferred_language
      CHECK (preferred_language IS NULL OR preferred_language IN ('en','fr'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_supplier_preferred_language'
  ) THEN
    ALTER TABLE supplier_master
      ADD CONSTRAINT ck_supplier_preferred_language
      CHECK (preferred_language IS NULL OR preferred_language IN ('en','fr'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_lead_preferred_language'
  ) THEN
    ALTER TABLE lead
      ADD CONSTRAINT ck_lead_preferred_language
      CHECK (preferred_language IS NULL OR preferred_language IN ('en','fr'));
  END IF;
END $$;

-- DOWN
--   ALTER TABLE client_master   DROP COLUMN IF EXISTS preferred_language;
--   ALTER TABLE supplier_master DROP COLUMN IF EXISTS preferred_language;
--   ALTER TABLE lead            DROP COLUMN IF EXISTS preferred_language;
