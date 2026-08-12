-- ============================================================================
-- PLATFORM DB — 0096 Kaizen ops capabilities (INFRASTRUCTURE_PLAN §3)
-- ============================================================================
--
-- 0094 and 0095 created the tables; the jobs that fill them shipped alongside.
-- Nothing could READ any of it: there were no ops routes, so there were no
-- capabilities to gate them with. This adds the three the router uses.
--
-- WHY THREE TIERS AND NOT ONE
--
--   ops.read     — the whole console surface: fleet health, backup freshness,
--                  the run log, drill history, uptime, scheduled windows.
--                  Safe for anyone on call; it reads tables the jobs already
--                  wrote and cannot change anything.
--
--   ops.operate  — re-run the work by hand: back up a tenant now, sync objects,
--                  scan integrity, fire a restore drill, probe uptime. These
--                  spend real I/O on a SHARED Postgres host, and a drill creates
--                  a full scratch copy of a tenant database. Someone who should
--                  be able to read a dashboard at 3am should not necessarily be
--                  able to start twelve concurrent pg_dumps from it.
--
--   ops.maintain — schedule or cancel a maintenance window. Separate because it
--                  is the only ops action TENANT USERS can see: an ANNOUNCE
--                  window puts a banner in front of every user of that tenant,
--                  and a READ_ONLY window parks their writes. That is a
--                  customer-facing act, and it does not follow from being
--                  allowed to run a backup.
--
-- GRANTED TO ROOT ADMIN ONLY, matching the precedent 0032 set and 0090 followed.
-- Root bypasses requireCap anyway, so this INSERT is really about making the
-- capabilities EXIST in the permission matrix, so an operator can grant them to
-- PLATFORM_SUPPORT or a custom on-call role from the Roles screen — deliberately,
-- rather than them being invisible until someone reads the router.
--
-- DOWN
-- DELETE FROM platform.platform_role_permission
--  WHERE capability IN ('ops.read','ops.operate','ops.maintain');

INSERT INTO platform.platform_role_permission (role_id, capability)
SELECT r.role_id, c.capability
FROM platform.platform_role r
CROSS JOIN (VALUES
  ('ops.read'),('ops.operate'),('ops.maintain')
) AS c(capability)
WHERE r.code = 'PLATFORM_ROOT_ADMIN'
ON CONFLICT DO NOTHING;

-- DOWN
-- DELETE FROM platform.platform_role_permission
--  WHERE capability IN ('ops.read','ops.operate','ops.maintain');
