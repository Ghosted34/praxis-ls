-- ============================================================================
-- TENANT DB — 0471 self-service password reset. One-time tokenized reset links
-- (requested at /api/tenant/auth/forgot-password, consumed at
-- /api/tenant/auth/reset-password). We store only a SHA-256 HASH of the token,
-- never the token itself, so a DB read can't be used to mint a working link.
-- Tokens are single-use (used_at) and short-lived (expires_at, 30 min). On a
-- successful reset the service force-logs-out every one of the user's sessions.
-- ============================================================================
CREATE TABLE IF NOT EXISTS password_reset (
  reset_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  token_hash    text NOT NULL,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  requested_ip  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Lookups are by token hash (reset step) and by user (invalidate outstanding
-- tokens when a fresh one is requested).
CREATE INDEX IF NOT EXISTS idx_password_reset_token_hash ON password_reset (token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_user       ON password_reset (user_id);
