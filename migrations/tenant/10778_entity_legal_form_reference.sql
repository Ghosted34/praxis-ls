-- Corporate-entity legal form reference (Phase 1).
--
-- `legal_form` remains the printable suffix/name used by letterheads (SARL,
-- GmbH, LLC). These three columns preserve which country-specific catalogue row
-- was selected. Without them, "LLC" cannot distinguish Alabama from Delaware
-- and a stored string cannot be reconciled to ISO 20275 after the fact.
--
-- Existing rows are deliberately left with a null reference: their free-text
-- value predates the picker and guessing a US state would manufacture legal
-- data. The picker recognizes unambiguous legacy values and writes the reference
-- on the next deliberate selection.
ALTER TABLE corporate_entity
  ADD COLUMN IF NOT EXISTS legal_form_code text,
  ADD COLUMN IF NOT EXISTS legal_form_source text,
  ADD COLUMN IF NOT EXISTS legal_form_jurisdiction text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'corporate_entity_legal_form_reference_complete'
       AND conrelid = 'corporate_entity'::regclass
  ) THEN
    ALTER TABLE corporate_entity
      ADD CONSTRAINT corporate_entity_legal_form_reference_complete CHECK (
        (legal_form_code IS NULL AND legal_form_source IS NULL AND legal_form_jurisdiction IS NULL)
        OR
        (legal_form_code IS NOT NULL AND legal_form_source IS NOT NULL AND legal_form_jurisdiction IS NOT NULL)
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'corporate_entity_legal_form_source_known'
       AND conrelid = 'corporate_entity'::regclass
  ) THEN
    ALTER TABLE corporate_entity
      ADD CONSTRAINT corporate_entity_legal_form_source_known CHECK (
        legal_form_source IS NULL OR legal_form_source IN ('GLEIF_ISO_20275', 'OHADA')
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'corporate_entity_legal_form_code_shape'
       AND conrelid = 'corporate_entity'::regclass
  ) THEN
    ALTER TABLE corporate_entity
      ADD CONSTRAINT corporate_entity_legal_form_code_shape CHECK (
        legal_form_code IS NULL OR legal_form_code ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,31}$'
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_corporate_entity_legal_form_reference
  ON corporate_entity (legal_form_source, legal_form_code, legal_form_jurisdiction)
  WHERE legal_form_code IS NOT NULL;

COMMENT ON COLUMN corporate_entity.legal_form IS
  'Printable legal-form abbreviation/name selected from the country-aware catalogue';
COMMENT ON COLUMN corporate_entity.legal_form_code IS
  'ISO 20275 ELF code or verified source-native OHADA form code';
COMMENT ON COLUMN corporate_entity.legal_form_source IS
  'Reference authority: GLEIF_ISO_20275 or OHADA';
COMMENT ON COLUMN corporate_entity.legal_form_jurisdiction IS
  'Country or ISO 3166-2 subdivision under whose law the form exists';

-- DOWN (only after clearing application references):
-- DROP INDEX IF EXISTS idx_corporate_entity_legal_form_reference;
-- ALTER TABLE corporate_entity
--   DROP COLUMN IF EXISTS legal_form_code,
--   DROP COLUMN IF EXISTS legal_form_source,
--   DROP COLUMN IF EXISTS legal_form_jurisdiction;
