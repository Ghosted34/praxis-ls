-- ============================================================================
-- TENANT SEED — 9085 The home page row, so the website editor is not empty.
--
-- ── WHY THIS EXISTS ────────────────────────────────────────────────────────
--
-- Settings › Website pages opened on "No pages yet" and a sentence telling the
-- reader to create a page with the key "home". That is an instruction, not a
-- screen: it asks somebody to guess a magic string before the product will do
-- anything, and it gives no hint that the only thing the page actually drives
-- is the figures strip under the hero. Every tenant met that screen and closed
-- it again.
--
-- So the row ships. The editor now opens on a home page carrying the two blocks
-- the public site genuinely renders, with the four figures a forwarder's
-- homepage wants already labelled and bound to a metric.
--
-- ── AND WHY IT SHIPS AS A DRAFT ────────────────────────────────────────────
--
-- `is_published = false`, unlike the service profiles in 9084. A counter bound
-- to `dossiers.completed_count` resolves against THIS tenant's ledger, so a
-- workspace provisioned this morning would publish "0 files completed" onto its
-- own homepage — a true number that reads as a dead business. `getPublicPage`
-- 404s an unpublished page and the strip draws nothing, which is the correct
-- empty state and the one the site already had. Nothing on the live site
-- changes until a person opens the page, looks at the numbers and presses
-- publish. That is the one decision a seed must not take for them.
--
-- ── WHY ONLY TWO BLOCK TYPES ───────────────────────────────────────────────
--
-- The library has fifteen. `public-web` reads `stat_counters` and `stat_chips`
-- and nothing else — see `lib/site-api.ts`, which says so in its own header.
-- Seeding a `hero` or a `testimonials` block would put content in the editor
-- that no page anywhere renders, which is the confusion this file exists to
-- remove rather than to double.
-- ============================================================================

INSERT INTO site_page (key, title_fr, title_en, is_published, sort_order)
VALUES (
  'home',
  $t$Page d'accueil$t$,
  $t$Home page$t$,
  false,
  10
)
ON CONFLICT (key) DO NOTHING;

-- ── The figures strip ──────────────────────────────────────────────────────
-- `metric_key` binds each counter to the registry, so the number rendered is
-- what the ledger says this morning and `value` is only the fallback used when
-- the metric is absent or fails. They are seeded at 0 deliberately: a non-zero
-- placeholder is a figure somebody has to notice is fake before launch, and the
-- ones nobody notices end up in front of a procurement officer.
-- Guarded by a DO block rather than by the INSERT's own WHERE NOT EXISTS.
-- Both are equally idempotent; only one is legible to
-- `scripts/db/check-migration-idempotency.js`, which reads a DO block as the
-- author's explicit catalog check and cannot see a guard buried in a SELECT.
-- `site_block` carries no unique key over (page_id, type) — a page may hold two
-- card grids — so there is no ON CONFLICT target to use instead.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM site_block b JOIN site_page p ON p.page_id = b.page_id
     WHERE p.key = 'home' AND b.type = 'stat_counters'
  ) THEN
    INSERT INTO site_block (page_id, type, sort_order, is_visible, content)
    SELECT p.page_id, 'stat_counters', 10, true, $j$
    {
      "items": [
        {
          "label":    {"fr": "Dossiers traités",     "en": "Files completed"},
          "sublabel": {"fr": "Opérations clôturées", "en": "Operations closed out"},
          "value": 0,
          "metric_key": "dossiers.completed_count"
        },
        {
          "label":    {"fr": "Clients servis",       "en": "Clients served"},
          "sublabel": {"fr": "Comptes actifs",       "en": "Active accounts"},
          "value": 0,
          "metric_key": "clients.served_count"
        },
        {
          "label":    {"fr": "Volume traité",        "en": "Volume handled"},
          "sublabel": {"fr": "Cumul des dossiers",   "en": "Across all files"},
          "unit": "CBM",
          "value": 0,
          "metric_key": "dossiers.volume_cbm_total"
        },
        {
          "label":    {"fr": "Services proposés",    "en": "Services offered"},
          "sublabel": {"fr": "Publiés sur ce site",  "en": "Published on this site"},
          "value": 0,
          "metric_key": "services.published_count"
        }
      ]
    }
    $j$::jsonb
      FROM site_page p
     WHERE p.key = 'home';
  END IF;
END
$do$;

-- ── The credentials row ────────────────────────────────────────────────────
-- Empty ON PURPOSE. A chip says "Commissionnaire agréé en douane · n° …" or
-- "Membre du réseau …" — facts about one specific company that this file cannot
-- know and must not invent, because a fabricated licence is worse than a
-- missing one. The block ships so the editor shows a labelled, empty section to
-- fill rather than a block type the tenant has to go and discover; an empty
-- `items` array renders nothing on the site.
-- Guarded by a DO block rather than by the INSERT's own WHERE NOT EXISTS.
-- Both are equally idempotent; only one is legible to
-- `scripts/db/check-migration-idempotency.js`, which reads a DO block as the
-- author's explicit catalog check and cannot see a guard buried in a SELECT.
-- `site_block` carries no unique key over (page_id, type) — a page may hold two
-- card grids — so there is no ON CONFLICT target to use instead.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM site_block b JOIN site_page p ON p.page_id = b.page_id
     WHERE p.key = 'home' AND b.type = 'stat_chips'
  ) THEN
    INSERT INTO site_block (page_id, type, sort_order, is_visible, content)
    SELECT p.page_id, 'stat_chips', 20, true, $j${"items": []}$j$::jsonb
      FROM site_page p
     WHERE p.key = 'home';
  END IF;
END
$do$;

-- ============================================================================
-- VERIFY
--   SELECT key, is_published FROM site_page;              -- home, false
--   SELECT type, sort_order, jsonb_array_length(content->'items')
--     FROM site_block b JOIN site_page p USING (page_id)
--    WHERE p.key = 'home' ORDER BY sort_order;            -- counters 4, chips 0
--   -- public read while still a draft:
--   -- GET /api/tenant/public/site/pages/home  -> 404, strip draws nothing
--
-- DOWN
--   DELETE FROM site_page WHERE key = 'home';   -- blocks CASCADE with it
-- ============================================================================
