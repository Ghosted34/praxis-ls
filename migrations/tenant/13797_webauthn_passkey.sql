-- ============================================================================
-- TENANT DB — 13797 WebAuthn passkey (passwordless).
--
-- A discoverable passkey is a device-bound credential bound to the tenant's
-- origin (RP ID). It is the passwordless counterpart to the device-bound PIN
-- (0443 user_device) — but where PIN is a shared secret (argon2), a passkey
-- is a public-key pair whose private half never leaves the authenticator.
--
-- WHY A TABLE AND NOT REUSING user_device:
-- user_device stores an argon2 hash of a short numeric secret and a failed
-- counter that revokes at 5. A passkey stores a COSE public key, a signature
-- counter (for clone detection), transports and attestation metadata. The
-- validation, lifecycle and security properties are disjoint — reusing the
-- table would be a union of nullable columns with no query reading both.
-- ============================================================================

CREATE TABLE IF NOT EXISTS webauthn_credential (
  credential_id       text PRIMARY KEY,                    -- base64url, from authenticator
  user_id             uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  public_key          text NOT NULL,                      -- base64url COSE key
  counter             bigint NOT NULL DEFAULT 0,          -- clone-detection
  transports          text[],                             -- ["internal","hybrid"] etc
  device_type         text NOT NULL DEFAULT 'singleDevice' CHECK (device_type IN ('singleDevice','multiDevice')),
  backed_up           boolean NOT NULL DEFAULT false,
  aaguid              text,                               -- authenticator model
  label               text,                               -- "MacBook Touch ID"
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_used_at        timestamptz
);

CREATE INDEX IF NOT EXISTS ix_webauthn_credential_user ON webauthn_credential(user_id);

COMMENT ON TABLE webauthn_credential IS 'WebAuthn passkeys (one row per credential). counter is the authenticator signature counter used for clone detection; public_key is the COSE key stored as base64url.';

-- DOWN
-- DROP TABLE IF EXISTS webauthn_credential;
