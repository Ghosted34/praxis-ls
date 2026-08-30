-- ============================================================================
-- TENANT — 12757 Insights: the tenant's own articles (WS5 of
-- doc/PUBLIC_WEB_PLAN.md).
--
-- ── DEPENDENCIES ─────────────────────────────────────────────────────────────
-- 0320  app_user        (FK target; the author)
-- 0340  document_vault  (FK target; the cover, and the public-media CHECK)
-- 0340  set_updated_at()
--
-- ── WHY A TABLE AND NOT `site_block` CONTENT ───────────────────────────────
-- 12753 already stores a page as ordered typed blocks, and an article is
-- tempting to model as one more block type. It is the wrong shape: an article
-- is a THING that gets listed, filtered by tag, dated, syndicated and linked to
-- by other pages, and a block is a piece of one page's layout. Modelling it as a
-- block would mean a page per article whose only job is to hold it, no way to
-- ask "the three most recent", and a tag filter that reads jsonb across every
-- page on the site.
--
-- ── THE AUTHOR IS A FOREIGN KEY, NOT A STRING ──────────────────────────────
-- Their site puts author names inside translation keys — `kaizen_by_prefix_
-- article` wraps "By Joseph MOUKOKO" — so a name is a piece of translatable
-- copy in two places, and the five authors are staff whose records this
-- database already holds. `author_user_id` gets the photo, the job title and a
-- future author page for nothing, and a name spelled once.
--
-- ON DELETE SET NULL rather than CASCADE or RESTRICT: a colleague who leaves
-- must not take their articles with them, and must not make themselves
-- undeletable either. The article survives, unattributed, and the desk can
-- reassign it.
--
-- ── TAGS ARE text[], AND THE FILTER IS DERIVED FROM THEM ────────────────────
-- Their filter bar is a hardcoded list of four (All / Strategy / Humanitarian /
-- Technology) while `data-tags` also contains `sustainability` and
-- `operations` — so two of their articles cannot be reached by ANY filter. A
-- separate `tag` table would be the tidy answer and is the wrong trade for a
-- handful of free-text labels a marketing writer invents; what fixes the bug is
-- that the public read DERIVES the filter list from the tags actually in use,
-- which a GIN index makes cheap.
-- ============================================================================

CREATE TABLE IF NOT EXISTS insight_article (
  insight_article_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug_fr             text,
  slug_en             text,
  -- FR is required and EN is not, matching service_type_web_profile and the
  -- reason given there: the tenant is Cameroonian, French is the default, and a
  -- half-translated article should be publishable in the language it is
  -- written in rather than blocked on a translation nobody has ordered.
  title_fr            text NOT NULL,
  title_en            text,
  excerpt_fr          text,
  excerpt_en          text,
  body_fr             text,
  body_en             text,
  meta_title_fr       text,
  meta_title_en       text,
  meta_description_fr text,
  meta_description_en text,
  cover_vault_id      uuid REFERENCES document_vault(doc_id),
  tags                text[] NOT NULL DEFAULT '{}'::text[],
  author_user_id      uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  is_published        boolean NOT NULL DEFAULT false,
  published_at        timestamptz,
  published_by        uuid REFERENCES app_user(user_id),
  sort_order          integer NOT NULL DEFAULT 100,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Partial unique per language, drafts included — the same precedent as 12745
-- and 0694. Two articles must never discover at publish time that they both
-- wanted /fr/la-douane-en-2026.
CREATE UNIQUE INDEX IF NOT EXISTS ux_insight_slug_fr
  ON insight_article(slug_fr) WHERE slug_fr IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_insight_slug_en
  ON insight_article(slug_en) WHERE slug_en IS NOT NULL;

-- The index the tag filter reads. GIN over text[] is what makes `tags && $1`
-- and the DISTINCT-tags roll-up cheap enough to run on every index page load
-- instead of caching a list that then goes stale.
CREATE INDEX IF NOT EXISTS ix_insight_tags ON insight_article USING GIN (tags);

-- The public list's own order: newest first among published. Partial, because
-- the drafts are never in that query and there are more of them over time.
CREATE INDEX IF NOT EXISTS ix_insight_published
  ON insight_article(published_at DESC NULLS LAST, sort_order ASC)
  WHERE is_published;

CREATE OR REPLACE TRIGGER trg_insight_updated
  BEFORE UPDATE ON insight_article
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN insight_article.tags IS
  'Free-text labels. The public filter list is DERIVED from the tags in use — never hardcoded.';
COMMENT ON COLUMN insight_article.author_user_id IS
  'The staff member who wrote it. SET NULL on departure: the article outlives the colleague.';
COMMENT ON COLUMN insight_article.published_at IS
  'When it went live. Shown on cards and sent as article:published_time — a knowledge hub that cannot show recency is not credible.';

-- ── document_vault: let a cover be served publicly ──────────────────────────
-- Same drop / re-add shape as 12745 and 10702, and idempotent by the same
-- guards. 'INSIGHT' joins the media scopes; the roles are unchanged, since an
-- article cover is a COVER.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_vault_public_media_scope'
       AND conrelid = 'document_vault'::regclass
  ) THEN
    ALTER TABLE document_vault DROP CONSTRAINT ck_vault_public_media_scope;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_vault_public_media_scope'
       AND conrelid = 'document_vault'::regclass
  ) THEN
    ALTER TABLE document_vault ADD CONSTRAINT ck_vault_public_media_scope
      CHECK (public_media_scope IS NULL OR public_media_scope IN ('SUCCESS_STORY', 'SERVICE_TYPE', 'INSIGHT'));
  END IF;
END $$;

-- ============================================================================
-- VERIFY
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'insight_article';          -- expect 21 rows
--
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'ck_vault_public_media_scope'; -- expect INSIGHT present
--
--   -- the tag roll-up the filter bar reads:
--   SELECT DISTINCT unnest(tags) FROM insight_article WHERE is_published;
--
--   -- an author who leaves does not take their articles:
--   DELETE FROM app_user WHERE user_id = '<id>';
--   SELECT author_user_id FROM insight_article WHERE insight_article_id = '<id>';
--   -- expect NULL, row still present
--
-- DOWN
--   DROP TRIGGER IF EXISTS trg_insight_updated ON insight_article;
--   DROP INDEX IF EXISTS ix_insight_published;
--   DROP INDEX IF EXISTS ix_insight_tags;
--   DROP INDEX IF EXISTS ux_insight_slug_en;
--   DROP INDEX IF EXISTS ux_insight_slug_fr;
--   DROP TABLE IF EXISTS insight_article;
--   -- Leave the vault CHECK alone: narrowing it back would refuse rows that
--   -- already exist, and an orphaned 'INSIGHT' scope value harms nothing.
-- ============================================================================
