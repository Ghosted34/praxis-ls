-- ============================================================================
-- TENANT DB — 0482 portal invitations + password recovery for EXTERNAL users.
--
-- WHY. `portal_access` (0340) grants by EMAIL and `portal_user` (0460) holds the
-- credentials, but nothing ever connected the two: granting a client access
-- created no login, and `POST /portal/users` (which does) had no caller. So every
-- grant issued to date points at somebody who cannot sign in. Same shape as the
-- session-17 service-type gap — a complete backend with no way to reach it.
--
-- Mirrors `password_reset` (0471) deliberately, including storing only a SHA-256
-- HASH of the token so a database read cannot mint a working link, single use via
-- `used_at`, and one live token per user at a time.
--
-- TWO PURPOSES, TWO LIFETIMES. An INVITE goes to someone who has never heard of
-- this system and may act on it days later — 30 minutes would burn most of them
-- and generate support load for the tenant. A RESET is requested by someone
-- sitting at the screen, so it keeps the short staff-grade window. The column
-- exists so the two can be told apart in the UI ("invited" vs "reset requested")
-- and so the TTL is data rather than a branch buried in code.
--
-- Lives in the identity (live) schema alongside portal_user, since it is
-- credential data — not per-environment business data.
-- ============================================================================

CREATE TABLE IF NOT EXISTS portal_invite (
  invite_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id  uuid NOT NULL REFERENCES portal_user(portal_user_id) ON DELETE CASCADE,
  token_hash      text NOT NULL,
  purpose         text NOT NULL DEFAULT 'INVITE' CHECK (purpose IN ('INVITE','RESET')),
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  requested_ip    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Lookups are by token hash (the accept/reset step) and by user (invalidating
-- outstanding tokens when a fresh one is issued).
CREATE INDEX IF NOT EXISTS idx_portal_invite_token_hash ON portal_invite (token_hash);
CREATE INDEX IF NOT EXISTS idx_portal_invite_user       ON portal_invite (portal_user_id);
