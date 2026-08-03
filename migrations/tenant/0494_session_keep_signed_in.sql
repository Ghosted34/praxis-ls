-- ============================================================================
-- TENANT DB — 0494 "Keep me signed in" exempts a session from the idle timeout
--
-- THE CONTRADICTION. The sign-in screen offers "Keep me signed in", which the
-- client honours by persisting the refresh token in localStorage (30-day TTL)
-- rather than sessionStorage. The server then kills any session idle for
-- SESSION_INACTIVITY_MIN (default 30) minutes — regardless of that choice. So
-- the checkbox promised thirty days and delivered half an hour, and a user who
-- stepped away from an open tab came back to "token expired".
--
-- The choice is now recorded on the session and honoured: a keep-signed-in
-- session skips the inactivity kill. Everything else still applies to it —
-- refresh-token rotation, reuse detection, remote kill, the 30-day refresh TTL
-- and `killed_at` — so it is a longer leash, not an exemption from revocation.
--
-- DEFAULT FALSE, deliberately. Sessions created before this column existed
-- keep the strict timeout rather than being silently upgraded; a user gets the
-- longer session on their next sign-in, when they actually tick the box.
-- ============================================================================

ALTER TABLE user_session
  ADD COLUMN IF NOT EXISTS keep_signed_in boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN user_session.keep_signed_in IS
  'User ticked "Keep me signed in" at login. Exempts the session from the SESSION_INACTIVITY_MIN idle kill (0494); rotation, reuse detection and remote kill still apply.';
