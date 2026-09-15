-- ============================================================================
-- TENANT — 13787 A corporate entity's public face.
--
-- ── WHAT IS DELIBERATELY NOT HERE: RCCM AND NIU ────────────────────────────
--
-- MOD-01 holds a full statutory dossier — legal form, incorporation date,
-- RCCM, NIU, cap table, governance, registrations. The public read (site_public)
-- selects an explicit allow-list from it, and the statutory identifiers are not
-- on that list.
--
-- Not because they are secret: RCCM is a matter of public record in Cameroon
-- and anyone can look it up. Because of what publishing them BUYS versus what
-- it COSTS. A visitor deciding whether to ship with a forwarder does not read
-- a trade-register number; it changes no decision. But those two numbers plus a
-- legal name and an address are most of what somebody needs to impersonate a
-- company convincingly to its own suppliers — and a freight forwarder's
-- counterparties routinely act on documents that carry exactly those fields.
--
-- Low value to the reader, real value to the attacker: that is the whole
-- argument, and it is why a `/legal` page (where somebody who needs the numbers
-- goes deliberately) is the right home for them if they are ever wanted, rather
-- than a marketing page that indexes them beside the CEO's photograph.
--
-- ── public_enabled DEFAULTS FALSE ──────────────────────────────────────────
--
-- Every existing entity stays off the website when this migration runs. A
-- tenant with a dormant holding company, a company being wound up, or one
-- registered for a tender they did not win, must not discover it on their own
-- About page after a deploy. Going public is an act, not a default.
--
-- ── coverage AND focus ARE jsonb LISTS ─────────────────────────────────────
--
-- Q11 named these the essential facts: where an entity operates and what it
-- does. Both are short ordered lists, read and written whole by one editor.
--   coverage: [{ country_code, label_fr, label_en }]
--   focus:    [{ label_fr, label_en, mode }]   mode ∈ sea|air|road|rail|null
--
-- `mode` is what lets the entity card carry the same harmonised transport
-- colour the services grid uses, so the About page speaks the site's colour
-- language rather than inventing a second one.
-- ============================================================================

ALTER TABLE corporate_entity
  ADD COLUMN IF NOT EXISTS public_enabled        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_summary_fr     text,
  ADD COLUMN IF NOT EXISTS public_summary_en     text,
  ADD COLUMN IF NOT EXISTS public_coverage       jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS public_focus          jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS public_cover_vault_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_entity_public_json' AND conrelid = 'corporate_entity'::regclass
  ) THEN
    ALTER TABLE corporate_entity ADD CONSTRAINT ck_entity_public_json
      CHECK (jsonb_typeof(public_coverage) = 'array' AND jsonb_typeof(public_focus) = 'array');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_entity_public_cover' AND conrelid = 'corporate_entity'::regclass
  ) THEN
    ALTER TABLE corporate_entity ADD CONSTRAINT fk_entity_public_cover
      FOREIGN KEY (public_cover_vault_id) REFERENCES document_vault(doc_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_entity_public ON corporate_entity (entity_id) WHERE public_enabled;

COMMENT ON COLUMN corporate_entity.public_enabled IS
  'Off by default and for every existing row. A dormant holding company or one registered for a lost tender must not appear on the website because a migration ran.';
COMMENT ON COLUMN corporate_entity.public_coverage IS
  'Where this entity operates: [{country_code, label_fr, label_en}]. Q11 named coverage and service focus the essential public facts about an entity — RCCM and NIU are deliberately NOT published; see this migration''s header.';
COMMENT ON COLUMN corporate_entity.public_focus IS
  'Service lines: [{label_fr, label_en, mode}] where mode is sea|air|road|rail or null. `mode` lets an entity card carry the same harmonised transport colour the services grid uses.';

-- ============================================================================
-- VERIFY
--   SELECT count(*) FROM corporate_entity WHERE public_enabled;  -- expect 0
--   UPDATE corporate_entity SET public_focus = '{}'::jsonb;      -- expect 23514
--
-- DOWN
--   DROP INDEX IF EXISTS ix_entity_public;
--   ALTER TABLE corporate_entity DROP CONSTRAINT IF EXISTS fk_entity_public_cover;
--   ALTER TABLE corporate_entity DROP CONSTRAINT IF EXISTS ck_entity_public_json;
--   ALTER TABLE corporate_entity DROP COLUMN IF EXISTS public_cover_vault_id;
--   ALTER TABLE corporate_entity DROP COLUMN IF EXISTS public_focus;
--   ALTER TABLE corporate_entity DROP COLUMN IF EXISTS public_coverage;
--   ALTER TABLE corporate_entity DROP COLUMN IF EXISTS public_summary_en;
--   ALTER TABLE corporate_entity DROP COLUMN IF EXISTS public_summary_fr;
--   ALTER TABLE corporate_entity DROP COLUMN IF EXISTS public_enabled;
-- ============================================================================
