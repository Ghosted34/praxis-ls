-- ============================================================================
-- TENANT — 12753 The tenant website's pages, as ordered typed blocks.
--
-- ── WHY BLOCKS AND NOT A PAGE TABLE WITH COLUMNS ───────────────────────────
-- Home and About are the two pages with no ERP data behind them, so they are
-- the two that need a content model. The obvious shapes both fail:
--
--   a column per field   Home alone wants a hero, three stat counters, a logo
--                        strip, four industry cards, three pillars, testimonials
--                        and two forms. As columns that is a table nobody can
--                        read, and About — which every tenant will want to differ
--                        — would add thirty more that Home never sets.
--
--   a page builder       Free-form layout is a six-month project, and tenants do
--                        not want it. They want to fill in their company's
--                        details and have it look right.
--
-- So: a fixed LIBRARY of typed blocks, ordered per page, each with defined
-- bilingual fields. The tenant chooses which blocks and in what order; they
-- never choose markup. That keeps one renderer serving every tenant, which is
-- the whole reason this is a platform feature and not a website project.
--
-- ── WHY content IS jsonb ───────────────────────────────────────────────────
-- Fourteen block types with different fields would otherwise be fourteen tables
-- and fourteen joins to render one page. The shape guarantee moves to the write
-- path instead: `type` is CHECKed against the library here, and the service
-- validates `content` against a per-type schema keyed by that same type
-- (src/modules/site/site_content/site_content.schema.js — the registry IS the contract).
--
-- The trade is stated plainly: Postgres will not stop a bad `content` written
-- by something that bypasses the service. Nothing may write these rows except
-- the service, and the schema registry is the single definition both the write
-- path and the renderer read.
--
-- ── WHY THE STAT BLOCK STORES A KEY AND NOT A QUERY ────────────────────────
-- The point of the whole project is that a statistic can be TRUE rather than
-- typed in — SmartLS hardcodes `data-counter="41850"` for CBM managed, and we
-- hold the dossiers that produce that number.
--
-- It is therefore tempting to let a stat block carry a query. It must not. A
-- tenant-editable string reaching the database as SQL is arbitrary execution by
-- design, and no amount of escaping makes that safe. Instead the block stores a
-- `metric_key` naming one of a registry of metrics IMPLEMENTED IN CODE, and the
-- resolver refuses anything not on it. Adding a metric is a code change with a
-- review, which is exactly the property wanted.
--
-- A literal value stays alongside as the fallback, so a tenant can publish
-- before a metric exists and swap later without touching the layout.
-- ============================================================================

CREATE TABLE IF NOT EXISTS site_page (
  page_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'home' | 'about' | ... — stable, referenced by the router, never shown.
  key                 citext UNIQUE NOT NULL,
  title_fr            text NOT NULL,
  title_en            text,
  -- NULL slug on the page that lives at the site root (home).
  slug_fr             text,
  slug_en             text,
  meta_title_fr       text,
  meta_title_en       text,
  meta_description_fr text,
  meta_description_en text,
  -- Publishing is per PAGE. An unpublished page 404s rather than rendering
  -- half-written copy on a domain a client's customers visit.
  is_published        boolean NOT NULL DEFAULT false,
  published_at        timestamptz,
  published_by        uuid REFERENCES app_user(user_id),
  -- Position in the site nav. Not the block order.
  sort_order          integer NOT NULL DEFAULT 100,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE site_page IS
  'A page of the tenant public website. Content lives in site_block; this row is identity, SEO and publish state.';

CREATE TABLE IF NOT EXISTS site_block (
  block_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE: a block has no meaning without its page.
  page_id     uuid NOT NULL REFERENCES site_page(page_id) ON DELETE CASCADE,
  type        text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 100,
  -- Hidden, not deleted: a tenant taking a section down for a season should not
  -- have to retype it in March.
  is_visible  boolean NOT NULL DEFAULT true,
  content     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The library. Extending it is a migration AND a schema-registry entry — the
-- CHECK is here so a typo cannot create a block type the renderer has never
-- heard of and which would therefore render as nothing at all.
ALTER TABLE site_block DROP CONSTRAINT IF EXISTS site_block_type_chk;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_block_type_chk') THEN
    ALTER TABLE site_block ADD CONSTRAINT site_block_type_chk CHECK (type IN (
      'hero',
      'stat_chips',
      'stat_counters',
      'logo_strip',
      'feature_list',
      'card_grid',
      'text_image',
      'two_column_values',
      'leader_message',
      'pillar_framework',
      'testimonials',
      'form_block',
      'contact_block',
      'cta_band',
      'policies'
    ));
  END IF;
END $$;

COMMENT ON COLUMN site_block.content IS
  'Per-type bilingual fields. Validated against site_content.schema.js on write; Postgres does not enforce the shape.';

-- The renderer reads one page in block order, and only visible blocks.
CREATE INDEX IF NOT EXISTS ix_site_block_page_order
  ON site_block (page_id, sort_order) WHERE is_visible;

CREATE INDEX IF NOT EXISTS ix_site_page_published
  ON site_page (is_published, sort_order);

-- ============================================================================
-- VERIFY
--   \d site_page
--   \d site_block
--   INSERT INTO site_block (page_id, type)
--        VALUES ((SELECT page_id FROM site_page LIMIT 1), 'carousel_of_doom');
--     -- expect: violates site_block_type_chk
--   -- CASCADE holds:
--   -- DELETE FROM site_page WHERE key = 'x';  → its blocks go with it.
--
-- DOWN
--   DROP INDEX IF EXISTS ix_site_page_published;
--   DROP INDEX IF EXISTS ix_site_block_page_order;
--   DROP TABLE IF EXISTS site_block;   -- blocks first: it references site_page
--   DROP TABLE IF EXISTS site_page;
-- ============================================================================
