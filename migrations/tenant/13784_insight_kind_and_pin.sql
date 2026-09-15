-- ============================================================================
-- TENANT — 13784 Announcements: an insight KIND, not a second CMS.
--
-- ── WHY THIS IS TWO COLUMNS AND NOT A TABLE ────────────────────────────────
--
-- An announcement — a partnership, a new certification, a corridor opening —
-- has a title, a body, a date, a cover, a slug, a publish action and a public
-- detail page. That is `insight_article`, exactly, down to the gallery. A
-- separate `site_announcement` table would have duplicated the editor, the
-- publish verb, the slug uniqueness, the vault plumbing and the public route,
-- and the two would have drifted at the first feature that touched only one.
--
-- So an announcement IS an article with `kind = 'announcement'`. Everything
-- already built for articles works on it on the day this migration lands.
--
-- ── pinned_until, AND WHY IT IS A TIMESTAMP RATHER THAN A BOOLEAN ──────────
--
-- The homepage band is for "the very important announcements" only. A boolean
-- `is_pinned` would answer that on the day it is set and never again: the
-- JCTrans membership pinned in March is still on the front page in November,
-- and nobody notices because nobody is looking at their own homepage.
--
-- An expiry means the tenant states how long it matters for, and the band
-- empties itself. Stale is the default failure of every "featured" flag ever
-- shipped, and a date is the cheapest thing that prevents it.
--
-- The public read additionally caps the pinned collection, so a tenant who
-- pins everything still gets a band rather than a list.
-- ============================================================================

ALTER TABLE insight_article
  ADD COLUMN IF NOT EXISTS kind         text NOT NULL DEFAULT 'article',
  ADD COLUMN IF NOT EXISTS pinned_until timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_insight_kind' AND conrelid = 'insight_article'::regclass
  ) THEN
    ALTER TABLE insight_article ADD CONSTRAINT ck_insight_kind
      CHECK (kind IN ('article', 'announcement'));
  END IF;
END $$;

-- Partial: the homepage read wants the handful of live pins, and the index that
-- serves it should be the size of that handful rather than of every article
-- ever written.
CREATE INDEX IF NOT EXISTS ix_insight_pinned ON insight_article (pinned_until DESC)
  WHERE pinned_until IS NOT NULL;

COMMENT ON COLUMN insight_article.kind IS
  'article | announcement. An announcement is an article with a different renderer, not a second CMS — it reuses the editor, the publish verb, the slug rules, the vault plumbing and the public route.';
COMMENT ON COLUMN insight_article.pinned_until IS
  'While in the future, this may appear in the homepage band. A timestamp rather than a boolean because a boolean goes stale in silence: nobody reads their own homepage, and the March pin is still there in November.';

-- ============================================================================
-- VERIFY
--   SELECT kind, count(*) FROM insight_article GROUP BY kind;  -- all 'article'
--   UPDATE insight_article SET kind = 'news';                  -- expect 23514
--
-- DOWN
--   DROP INDEX IF EXISTS ix_insight_pinned;
--   ALTER TABLE insight_article DROP CONSTRAINT IF EXISTS ck_insight_kind;
--   ALTER TABLE insight_article DROP COLUMN IF EXISTS pinned_until;
--   ALTER TABLE insight_article DROP COLUMN IF EXISTS kind;
--   -- Any announcement reverts to being an ordinary article, which is what it
--   -- already is in every other respect. Nothing is lost but the distinction.
-- ============================================================================
