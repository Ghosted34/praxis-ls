-- ============================================================================
-- PLATFORM DB — 0099 Close the default-open door on the platform database
-- ============================================================================
--
-- Found by `npm run db:creds:verify` (WS-S2's negative test), which is exactly
-- what that check exists for:
--
--     smartls (praxis_smartls): own=connected; foreign reachable=praxis_platform
--     ISOLATION BREACH — a tenant credential opens a database it must not.
--
-- WHY IT HAPPENED
--
--   Postgres grants CONNECT on every database to PUBLIC by default. Every role
--   with LOGIN can therefore open every database in the cluster unless someone
--   takes that away.
--
--   `ensureTenantRole()` already does take it away — but only for the TENANT
--   database it is creating (`REVOKE CONNECT ON DATABASE <tenant> FROM PUBLIC`,
--   then a grant back to that one role). That is why no tenant role can reach
--   another TENANT's database. Nothing ever performed the equivalent for the
--   platform database, because the platform database predates per-tenant roles
--   and there were no non-superuser roles in the cluster to keep out.
--
--   WS-S2 created them. The hole did not appear when this migration was
--   written; it appeared the moment the first tenant got its own credential.
--
-- WHY IT MATTERS EVEN THOUGH NO TABLE GRANTS EXIST
--
--   PUBLIC has no table privileges here, so connecting is not the same as
--   reading. But the platform database holds `platform_setting` — the encrypted
--   secrets vault, including every tenant's database password — plus the tenant
--   registry. "They can open a connection but the tables are locked" is one
--   misplaced GRANT away from being false, and defence that depends on a second
--   control never slipping is not defence. The tenancy invariant is that a
--   tenant credential opens exactly one database.
--
-- WHAT THIS DOES NOT BREAK
--
--   Superusers bypass CONNECT entirely, and the application, the migrator and
--   the worker all connect to this database as the deploy-wide admin role. The
--   grant below is belt-and-braces for the case where that role is NOT a
--   superuser — `current_user` is whoever runs this migration, which is exactly
--   the identity the app uses.
--
--   The pooler's lookup role is handled separately, in
--   scripts/db/setup-pgbouncer-auth.js, which grants it CONNECT explicitly.
--   Doing it there rather than here keeps the grant next to the role's creation,
--   so enabling PgBouncer cannot half-work.
--
-- AFTER THIS RUNS, re-run the check that found it:
--     npm run db:creds:verify
--
-- DOWN
-- Restoring the default-open state is deliberately NOT scripted: it re-opens a
-- security hole, and doing that should be a considered act, not a rollback.
--   GRANT CONNECT ON DATABASE <db> TO PUBLIC;

DO $$
DECLARE
  db text := current_database();
BEGIN
  -- %I quotes the identifier: the database name comes from the cluster, not a
  -- literal, and deployments name it differently (praxis_platform here,
  -- praxislsdata by default).
  EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', db);
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', db, current_user);
END
$$;

-- DOWN
--   GRANT CONNECT ON DATABASE <db> TO PUBLIC;   -- re-opens the hole; see above
