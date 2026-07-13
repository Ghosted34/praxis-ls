-- ============================================================================
-- TENANT DB — 0443 device-bound quick PIN login. A user who has fully
-- authenticated (password + 2FA) can register a per-device PIN for fast unlock.
-- PIN login only works from a registered ACTIVE device; a new device or repeated
-- PIN failures force a full password login (PIN + password-fallback model).
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_device (
  device_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  label         text,
  pin_hash      text NOT NULL,                       -- argon2id(PIN); never returned
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  failed_pin    integer NOT NULL DEFAULT 0,          -- lockout counter; revokes at threshold
  last_used_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_user_device_user ON user_device(user_id);
