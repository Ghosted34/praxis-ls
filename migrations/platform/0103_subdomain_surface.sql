-- ============================================================================
-- PLATFORM DB — 0103 What a host actually serves
--
-- A tenant has two stranger-facing addresses, not one: the workspace subdomain
-- their staff sign into (smartls.praxisls.com) and, once they bring one, their
-- own domain for the public site (smartls.cm). Those are the same tenant and
-- must resolve to the same database — which `platform.subdomain` already does,
-- because it is keyed on an arbitrary host string — but they must NOT serve the
-- same application. The staff ERP has no business answering on a domain a
-- client prints on an invoice.
--
-- WHY THIS IS A COLUMN AND NOT AN ENVIRONMENT VARIABLE
--
--   The first attempt at this was `PUBLIC_WEB_HOST`, copied from
--   `PLATFORM_CONSOLE_HOST`. That copy was the bug: there is ONE console for the
--   whole platform, so a single value is the right shape for it — and there is
--   one public site PER TENANT, so a single value can name exactly one tenant's
--   domain and every other tenant's falls through to the staff app. A per-tenant
--   fact belongs in the per-tenant table.
--
--   It also decides who can do the work. As config, adding a client's domain is
--   an env edit and a restart on the host, which means whoever holds the server.
--   As data it is one row, which means the platform console, which means the
--   person who onboards the client.
--
-- 'erp' is the default and is what every existing row means: the workspace host,
-- serving the ERP at its root. Nothing changes for any host already registered.
-- ============================================================================

ALTER TABLE platform.subdomain
  ADD COLUMN IF NOT EXISTS surface text NOT NULL DEFAULT 'erp';

-- Two values, and a constraint rather than a comment, because this one is read
-- on the request path: an unrecognised surface would fall back to serving the
-- ERP, which on a tenant's public domain is precisely the failure being closed.
ALTER TABLE platform.subdomain
  DROP CONSTRAINT IF EXISTS subdomain_surface_chk;
-- The add is guarded on pg_constraint as well as dropped first: `ADD CONSTRAINT`
-- has no IF NOT EXISTS in any Postgres version, and a migration re-runs more
-- often than people expect (a part-way failure replays the WHOLE file). After
-- the drop above the guard is always true on a real run, which is the point —
-- this REPLACES the definition rather than preserving whichever got there first.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'subdomain_surface_chk'
       AND conrelid = 'platform.subdomain'::regclass
  ) THEN
    ALTER TABLE platform.subdomain
      ADD CONSTRAINT subdomain_surface_chk CHECK (surface IN ('erp', 'public'));
  END IF;
END $$;

COMMENT ON COLUMN platform.subdomain.surface IS
  'Which application this host serves: erp = the tenant workspace (default), public = the marketing site and external portal only.';

-- DOWN
--   ALTER TABLE platform.subdomain DROP CONSTRAINT IF EXISTS subdomain_surface_chk;
--   ALTER TABLE platform.subdomain DROP COLUMN IF EXISTS surface;
