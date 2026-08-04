-- 0495 — Timestamp the last failed login, so the counter can be enforced.
--
-- Audit SEC-C3 (Critical), second half. `failed_logins` has been incremented on
-- every bad password since 0100 and reset on success — and never READ. The
-- audit's wording: "rate limiting is absent and the failed-login counter is
-- never enforced." The rate limiting landed on 2026-08-04; this is the counter.
--
-- WHY A TIMESTAMP AND NOT A `locked_until`:
--
-- A hard lockout is a denial-of-service lever. Anyone who knows a colleague's
-- email can lock them out by failing their login N times, and if the unlock
-- needs an administrator then one attacker disables the whole finance team
-- before lunch. That trades a brute-force problem for a worse availability one.
--
-- Storing only "when did the failures happen" lets the application compute a
-- cooldown that DECAYS on its own (see app_user.service.js `throttleFor`). The
-- account is never latched into a locked state, nothing needs an admin to
-- clear, and a legitimate user who mistyped four times is delayed by seconds
-- rather than blocked. `status = 'LOCKED'` already exists for the deliberate,
-- administrative case and is untouched by this.
--
-- Nullable with no backfill: NULL means "no recorded failure", which is the
-- correct reading for every existing row and makes the migration additive.
-- Applied to both identity tables — the external portal (SEC-H6) is the
-- internet-facing tier and needs it more than staff do.

ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS last_failed_login_at timestamptz;

ALTER TABLE portal_user
  ADD COLUMN IF NOT EXISTS last_failed_login_at timestamptz;

COMMENT ON COLUMN app_user.last_failed_login_at IS
  'When failed_logins was last incremented. Drives the decaying login cooldown in app_user.service.js (SEC-C3). NULL = no failure on record.';
COMMENT ON COLUMN portal_user.last_failed_login_at IS
  'When failed_logins was last incremented. Drives the decaying login cooldown (SEC-C3). NULL = no failure on record.';

-- DOWN
-- Additive and fully reversible. Dropping the column re-opens SEC-C3 (the
-- counter becomes unenforceable again) but loses no business data — the column
-- holds only the timestamp of the most recent failed attempt.
--
-- ALTER TABLE app_user    DROP COLUMN IF EXISTS last_failed_login_at;
-- ALTER TABLE portal_user DROP COLUMN IF EXISTS last_failed_login_at;
