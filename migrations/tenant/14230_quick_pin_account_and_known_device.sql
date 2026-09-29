-- ============================================================================
-- TENANT DB — 14230 One Quick PIN per person, on any device; and a device the
-- SERVER remembers, so a browser clearing its storage cannot make it forget.
--
-- ── 1. THE QUICK PIN BELONGS TO THE PERSON, NOT THE DEVICE ─────────────────
--
-- Owner decision, 29 Sep 2026: "my Quick PIN I can use on my phone, my laptop
-- and anywhere. The only thing per device is the passkey henceforth."
--
-- 0443 stored one PIN per (person, browser) in `user_device`, and sign-in
-- needed the browser's own device_id from localStorage — so the PIN set on the
-- laptop was useless on the phone, and a browser that lost its storage lost its
-- PIN. `user_quick_pin` is one row per person. What made four digits safe on a
-- device was that an attacker needed the device; now they need only the email,
-- so the protection moves to the ACCOUNT (app_user.service pinLogin):
--
--   · five wrong PINs in a row, from anywhere, switch the PIN off;
--   · ten wrong PINs in any 30 days switch it off too — a patient attacker who
--     keeps under five (the owner's own correct PIN resets the run) still runs
--     out, at ten guesses a month instead of an unlimited number;
--   · an account with an authenticator app still asks for its code after the
--     PIN. The PIN stands in for the password, never for the second factor.
--
-- EXISTING PINs CARRY OVER. Each person keeps the PIN they used most recently
-- (the one they are likeliest to remember); the argon2id hash is copied as is,
-- so nobody is asked to set one again. `user_device` is left in place and is no
-- longer read — dropping it is a later, separate decision.
--
-- ── 2. user_known_device — THE DEVICE, REMEMBERED WHERE IT CANNOT BE WIPED ──
--
-- The sign-in screen greets the person a device belongs to and leads with that
-- device's passkey. Until now both facts lived only in the browser's
-- localStorage, which the BROWSER deletes on its own schedule: Safari erases
-- every script-written store of a site not opened in seven days of browsing,
-- and every engine evicts under storage pressure. The passkey itself survived
-- in the OS keychain, but the screen no longer knew to offer it — "it forgot
-- me".
--
-- A server-set, HttpOnly cookie is outside all of that. It carries 32 random
-- bytes; this table keys on their SHA-256, so a database read cannot be turned
-- back into a cookie. It is NOT a credential: it grants no session, skips no
-- factor, and reveals only what the same device's localStorage already held —
-- who signs in here and which of their passkeys live here. `passkey_ids` is
-- read joined to webauthn_credential, so a passkey removed in My security is
-- never offered again, whatever this array still says.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_quick_pin (
  user_id            uuid PRIMARY KEY REFERENCES app_user(user_id) ON DELETE CASCADE,
  pin_hash           text NOT NULL,                     -- argon2id(PIN); never returned
  failed_attempts    integer NOT NULL DEFAULT 0,        -- misses in a row; 5 switches it off
  window_started_at  timestamptz,                       -- start of the rolling 30-day window
  window_failures    integer NOT NULL DEFAULT 0,        -- misses in that window; 10 switches it off
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz
);

COMMENT ON TABLE user_quick_pin IS
  'One Quick PIN per person, valid on any device (14230). Switched off (row deleted) after 5 misses in a row or 10 in 30 days; see app_user.service pinLogin.';

-- Carry each person's most recently used device PIN over (0443 → 14230).
INSERT INTO user_quick_pin (user_id, pin_hash, created_at, updated_at, last_used_at)
SELECT DISTINCT ON (d.user_id) d.user_id, d.pin_hash, d.created_at, d.created_at, d.last_used_at
  FROM user_device d
 WHERE d.status = 'ACTIVE'
 ORDER BY d.user_id, COALESCE(d.last_used_at, d.created_at) DESC
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_known_device (
  device_hash    text NOT NULL,                         -- sha256 hex of the device cookie; the cookie itself is never stored
  user_id        uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  label          text,                                  -- "Chrome on macOS", from the User-Agent
  passkey_ids    text[] NOT NULL DEFAULT '{}',          -- passkeys proven on this device (read joined to webauthn_credential)
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_hash, user_id)
);

CREATE INDEX IF NOT EXISTS ix_user_known_device_user ON user_known_device(user_id);

COMMENT ON TABLE user_known_device IS
  'Devices the server remembers for the sign-in greeting (14230). Keyed by sha256 of an HttpOnly cookie; grants no access. See app_user/known-device.js.';

-- ============================================================================
-- VERIFY
--   SELECT count(*) FROM user_quick_pin;        -- ≤ people with an ACTIVE user_device row
--   SELECT count(*) FROM user_known_device;     -- 0 until the first sign-in after deploy
--
-- DOWN
--   -- The old device PINs are untouched in user_device, so 0443 still works.
--   -- DROP TABLE IF EXISTS user_known_device;
--   -- DROP TABLE IF EXISTS user_quick_pin;
-- ============================================================================
