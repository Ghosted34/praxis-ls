-- ============================================================================
-- PLATFORM DB — 0104 Where a host's public site lives
--
-- 0103 recorded WHAT a host serves. This records WHERE, for the half that moves:
-- the marketing prefix. `/public` was hardcoded in ninety-odd places, which made
-- it a decision the whole fleet shared and nobody could revisit — and the name
-- is one a tenant has an opinion about, because it appears in every URL they
-- print, email or hand to a search engine.
--
-- PER HOST, not per tenant, and that is the point: the same tenant wants
-- `/public` (or `/site`) on their workspace subdomain and nothing at all on
-- their own domain, once the app can be mounted at a root.
--
-- `/portal` is deliberately NOT here. Invitation and set-password emails already
-- in circulation point at it with a seven-day expiry and the ERP links its staff
-- there; a console field that can break links sitting in someone's inbox is a
-- footgun rather than a feature. The reserved-prefix list in
-- src/shared/http/public-web-paths.js refuses it, along with every ERP section.
-- ============================================================================

ALTER TABLE platform.subdomain
  ADD COLUMN IF NOT EXISTS public_base text NOT NULL DEFAULT '/public';

-- Shape, not vocabulary: one leading slash, one lowercase segment. WHICH words
-- are refused lives in code, next to the route table it has to agree with — a
-- CHECK constraint listing the ERP's sections would be a second copy of that
-- list, and the one that never gets updated.
ALTER TABLE platform.subdomain
  DROP CONSTRAINT IF EXISTS subdomain_public_base_chk;
-- Guarded add, same reason as 0103: `ADD CONSTRAINT` has no IF NOT EXISTS, and
-- this file must survive being run twice.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'subdomain_public_base_chk'
       AND conrelid = 'platform.subdomain'::regclass
  ) THEN
    ALTER TABLE platform.subdomain
      ADD CONSTRAINT subdomain_public_base_chk
      CHECK (public_base ~ '^/[a-z0-9][a-z0-9-]{0,30}$');
  END IF;
END $$;

COMMENT ON COLUMN platform.subdomain.public_base IS
  'Path prefix the marketing site is served at on this host, e.g. /public or /site. The portal is always /portal.';

-- DOWN
--   ALTER TABLE platform.subdomain DROP CONSTRAINT IF EXISTS subdomain_public_base_chk;
--   ALTER TABLE platform.subdomain DROP COLUMN IF EXISTS public_base;
