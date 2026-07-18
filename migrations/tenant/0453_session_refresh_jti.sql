-- ============================================================================
-- TENANT DB — 0451 refresh-token rotation with reuse detection. Each session
-- tracks the jti of its CURRENT (latest-issued) refresh token. On refresh the
-- presented token's jti must match; a mismatch means an old/stolen token was
-- replayed after rotation → the session is revoked. Legacy sessions created
-- before this column exists carry NULL and are grandfathered (no reuse check)
-- until their next refresh stamps a jti.
-- ============================================================================
ALTER TABLE user_session ADD COLUMN IF NOT EXISTS refresh_jti uuid;
