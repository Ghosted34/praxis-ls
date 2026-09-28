-- ============================================================================
-- TENANT DB — 14210 A signature can be confirmed with a passkey.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- Owner decision, 28 Sep 2026: signing a document needs the signer's
-- fingerprint or face (a passkey, the way a bank approves a transfer), with
-- the emailed code only where a device cannot do passkeys. The evidence that
-- collects is neither SES (a session) nor AES_OTP (an emailed code), so it
-- gets its own level, AES_PASSKEY, and the credential that made it is
-- recorded beside the row — which device, not only which person.
--
-- ── SHAPE ──────────────────────────────────────────────────────────────────
--
-- Plain columns only on an existing table (the 13791 rule — see
-- tests/unit/migration-constraint-ordering.test.js). So the old CHECK on
-- assurance_level cannot be WIDENED here; it is dropped, and the vocabulary is
-- enforced where the value is chosen: document_signature.service signInternal
-- derives it from the evidence collected (never from a request body), and
-- ASSURANCE_LEVELS there is the list. `passkey_credential_id` is plain text —
-- credentials live in the LIVE identity schema, so no FK can reach them.
-- ============================================================================

ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS passkey_credential_id text;

-- DESTRUCTIVE: DROP CONSTRAINT — the CHECK cannot be widened on an existing table (13791 rule); the service enforces the list instead. No data changes.
ALTER TABLE document_signature DROP CONSTRAINT IF EXISTS ck_sig_assurance;

COMMENT ON COLUMN document_signature.passkey_credential_id IS
  'AES_PASSKEY only: the webauthn_credential (LIVE identity schema) whose user-verified assertion confirmed this signature. No FK — cross-schema.';

-- ============================================================================
-- VERIFY
--   SELECT DISTINCT assurance_level FROM document_signature;   -- ⊆ ASSURANCE_LEVELS
--
-- DOWN
--   -- Only safe while no row carries AES_PASSKEY.
--   -- ALTER TABLE document_signature ADD CONSTRAINT ck_sig_assurance
--   --   CHECK (assurance_level IN ('SES','AES_OTP','QES','WET'));
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS passkey_credential_id;
-- ============================================================================
