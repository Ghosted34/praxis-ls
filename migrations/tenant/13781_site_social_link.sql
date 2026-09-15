-- ============================================================================
-- TENANT — 13781 Social links for the website footer.
--
-- ── PASTE A URL, IT APPEARS; LEAVE IT BLANK, IT DOES NOT EXIST ─────────────
--
-- One row per platform the tenant actually uses. There is no `is_active`, no
-- sort order and no display name, because the requirement has none of those:
-- the footer renders the platforms that have a URL, in the registry's own
-- order, and nothing else. A table with three columns nobody sets is three
-- columns somebody will eventually set inconsistently.
--
-- ── WHY `platform` IS THE PRIMARY KEY AND HAS NO CHECK ─────────────────────
--
-- The key means "one LinkedIn per tenant", which is the real rule — a footer
-- with two LinkedIn icons is a bug, and the database is the right place to say
-- so.
--
-- There is deliberately NO `CHECK (platform IN (...))`. The closed list lives
-- in `packages/shared/design/social.js`, read by the validator, the settings
-- picker and the renderer. A CHECK here would be a fourth copy, it would drift
-- the first time a platform is added, and the failure mode is a migration to
-- deploy before a tenant can paste a link. The validator refuses an unknown
-- platform with a 422 that names the allowed set.
--
-- ── THE URL RULE, WHICH IS NOT PEDANTRY ────────────────────────────────────
--
-- The validator requires https and a host matching the platform's own pattern.
-- A "LinkedIn" glyph in a tenant's footer that links anywhere at all is a
-- phishing primitive hosted on the tenant's own domain, under their branding,
-- pointed at by their customers. The rule lives in packages/shared so the form
-- and the API refuse exactly the same strings.
-- ============================================================================

CREATE TABLE IF NOT EXISTS site_social_link (
  platform    text PRIMARY KEY,
  url         text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES app_user(user_id),

  CONSTRAINT ck_site_social_url CHECK (url ~* '^https://')
);

COMMENT ON TABLE site_social_link IS
  'Footer social links, one row per platform. Absence IS the empty state — a platform with no row is not rendered. The closed platform list lives in packages/shared/design/social.js, never in a CHECK here, so adding one does not need a migration.';
COMMENT ON COLUMN site_social_link.url IS
  'https only, and the validator additionally requires the host to match the platform. A social glyph linking anywhere at all is a phishing primitive on the tenant''s own domain.';

-- ============================================================================
-- VERIFY
--   INSERT INTO site_social_link(platform, url) VALUES ('linkedin', 'http://x');
--     -- expect 23514 (not https)
--   INSERT INTO site_social_link(platform, url) VALUES ('linkedin', 'https://a'),
--                                                      ('linkedin', 'https://b');
--     -- expect 23505 (one per platform)
--
-- DOWN
--   DROP TABLE IF EXISTS site_social_link;
-- ============================================================================
