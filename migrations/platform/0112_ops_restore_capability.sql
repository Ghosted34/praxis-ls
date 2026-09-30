-- ============================================================================
-- PLATFORM DB — 0112 `ops.restore`: putting data BACK into a live tenant
-- ============================================================================
--
-- 0096 created three ops tiers, split by blast radius. All three share one
-- property: nothing they allow can destroy tenant data. `ops.operate` spends
-- I/O and can build a full scratch copy of a tenant database, but the copy is
-- a throwaway and the live tenant is never written to.
--
-- The console now offers recovery — restoring a database from a dump, and
-- putting missing documents back into primary storage. That breaks the
-- property, so it does not belong in `ops.operate`:
--
--   ops.restore  — put data back into a LIVE tenant. Restore a tenant database
--                  from a backup into a NEW database (the console never
--                  overwrites the existing one), and restore documents that
--                  are missing from primary storage.
--
-- WHY A FOURTH TIER RATHER THAN REUSING ops.operate
--
--   Because of what sits next to it. The value of the monthly rehearsal is
--   that the entire drill path is incapable of touching live data — that is
--   what makes it safe to run unattended, and safe to give to whoever is on
--   call. Folding recovery into the same capability would mean everyone who
--   can click "Drill" can also click the button beside it that replaces a
--   tenant's data. The buttons are adjacent; the permissions must not be.
--
--   It is also the honest description of the risk. Recovery is a decision with
--   data-loss consequences — the restored dump is older than the damage, and
--   everything written in between is gone. A person who can read a dashboard
--   at 3am and re-run a backup is not, by that fact, the person who should be
--   making that call.
--
-- THE CODE IS NOT THE ONLY GUARD. The restore endpoint also requires the
-- caller to type the tenant slug back, restores into a new database rather
-- than over the existing one, and states on screen that the remaining cutover
-- steps (runbook §4.3a) are still manual. This capability is the outer gate.
--
-- GRANTED TO ROOT ADMIN ONLY, matching 0096. Root bypasses requireCap anyway,
-- so the INSERT is really about making the capability EXIST in the permission
-- matrix, so it can be granted deliberately from the Roles screen rather than
-- being invisible until someone reads the router.
--
-- DOWN
-- DELETE FROM platform.platform_role_permission WHERE capability = 'ops.restore';

INSERT INTO platform.platform_role_permission (role_id, capability)
SELECT r.role_id, 'ops.restore'
FROM platform.platform_role r
WHERE r.code = 'PLATFORM_ROOT_ADMIN'
ON CONFLICT DO NOTHING;

-- DOWN
-- DELETE FROM platform.platform_role_permission WHERE capability = 'ops.restore';
