-- ============================================================================
-- TENANT DB — 10708 God-Mode PIN expiry + rotation (G24, PRD §8.5)
--
-- The legacy minted a fresh 6-character God-Mode token weekly and refused any
-- token past its expiry. The rebuild's PIN is an Argon2 hash with NO expiry and
-- NO rotation — a PIN shared in month one still purges in month nine. These
-- two timestamps give the credential the same short life: set_at records when
-- it was minted, expires_at is what purge() refuses against, and the weekly
-- rotation job mints + re-stamps.
-- ============================================================================

ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS godmode_pin_set_at     timestamptz,
  ADD COLUMN IF NOT EXISTS godmode_pin_expires_at timestamptz;

-- DOWN
--   ALTER TABLE app_user DROP COLUMN IF EXISTS godmode_pin_expires_at;
--   ALTER TABLE app_user DROP COLUMN IF EXISTS godmode_pin_set_at;
