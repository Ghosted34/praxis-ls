-- ============================================================================
-- TENANT — 13785 The group's About: the story, once, for the whole company.
--
-- ── WHY THE GROUP STORY IS A SINGLETON AND NOT THE ROOT ENTITY ─────────────
--
-- `corporate_entity` has `parent_entity_id`, so the group COULD be inferred as
-- the entity with no parent. It is not, for one reason: inferring the group
-- from a tree a tenant may never have populated means an About page that comes
-- up empty on exactly the tenants who have one company and no hierarchy —
-- which is most of them, and all of them on day one.
--
-- A singleton always exists. The page always has a story.
--
-- ── THE TWO TIERS, AND WHICH FACT BELONGS WHERE ────────────────────────────
--
-- This table       the COMPANY's story: mission, vision, principles, ESG,
--                  founding, headquarters, timeline. Edited in settings.
-- 13787 (entity)   what one legal company DOES: where, which corridors, which
--                  services. Edited in that entity's own dossier.
--
-- The split is the one that stays correct as a group grows: a group's mission
-- does not belong to a subsidiary, and a subsidiary's coverage does not belong
-- to the group. Putting both on the entity would have meant retyping the
-- mission per company; putting both here would have meant one blob of prose
-- that no entity page could draw from.
--
-- ── WHY esg AND timeline ARE jsonb ─────────────────────────────────────────
--
-- Both are ordered lists of short, uniform records that are read and written
-- WHOLE, always, by one editor — the same three properties that made
-- `service_promises` jsonb in 0691 and `gallery_vault_ids` an array in 13773.
-- A child table would buy a join and cost a second screen.
--
-- The ESG shape is three fixed pillars, each with a paragraph and bullets,
-- because that is what the framework is; it is not an open key-value bag. The
-- shared schema pins it, so the renderer can build a three-panel interactive
-- rather than guessing at whatever the editor typed.
-- ============================================================================

CREATE TABLE IF NOT EXISTS site_about (
  site_about_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton      boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),

  -- FR is the required half and EN the optional one, matching site_block
  -- (12753) exactly: every bilingual field in this product falls back to
  -- French rather than to a blank, because a blank is what a visitor reads as
  -- a broken page.
  headline_fr    text,
  headline_en    text,
  summary_fr     text,
  summary_en     text,
  mission_fr     text,
  mission_en     text,
  vision_fr      text,
  vision_en      text,

  -- [{ label_fr, label_en, text_fr, text_en }]
  principles     jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- { environment: { text_fr, text_en, points: [...] }, social: {...}, governance: {...} }
  esg            jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- [{ year, label_fr, label_en, text_fr, text_en }]
  timeline       jsonb NOT NULL DEFAULT '[]'::jsonb,

  founded_year   integer,
  headquarters   text,

  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES app_user(user_id),

  CONSTRAINT ck_site_about_principles CHECK (jsonb_typeof(principles) = 'array'),
  CONSTRAINT ck_site_about_timeline   CHECK (jsonb_typeof(timeline) = 'array'),
  CONSTRAINT ck_site_about_esg        CHECK (jsonb_typeof(esg) = 'object'),
  CONSTRAINT ck_site_about_founded    CHECK (founded_year IS NULL OR founded_year BETWEEN 1800 AND 2200)
);

COMMENT ON TABLE site_about IS
  'The GROUP story — mission, vision, principles, ESG, timeline. A singleton so the About page always has content, rather than being inferred from a corporate_entity tree most tenants never populate. Per-entity facts live on the entity (13787).';
COMMENT ON COLUMN site_about.esg IS
  'Three fixed pillars (environment, social, governance), each a paragraph plus bullets. Pinned by the shared schema so the renderer can build a three-panel interactive instead of guessing at whatever an editor typed.';

INSERT INTO site_about (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

-- ============================================================================
-- VERIFY
--   SELECT count(*) FROM site_about;                      -- expect exactly 1
--   UPDATE site_about SET esg = '[]'::jsonb;              -- expect 23514
--   UPDATE site_about SET founded_year = 1500;            -- expect 23514
--
-- DOWN
--   DROP TABLE IF EXISTS site_about;
-- ============================================================================
