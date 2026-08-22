-- ============================================================================
-- TENANT DB — 10783 The OTP challenge.
--
-- doc/SIGNATURE_ENGINEERING_GUIDE.md §6.4 (Q6 = A, Q8 = B), §6.5 (Q9).
--
-- ── THE BINDING IS THE POINT ───────────────────────────────────────────────
-- A code is bound to (party_id | user_id, entity_ref, content_hash). The third
-- element is the one a reviewer should refuse to lose:
--
--   MUST. Without content_hash, a code issued for one document could be
--   replayed against another in the same request window. A code verifies ONE
--   PAYLOAD, not "a document, roughly, around now".
--
-- ── THE LIMITS, AND WHY THEY ARE THESE NUMBERS ─────────────────────────────
--   Lifetime  10 minutes  — long enough to switch to a mail client on a phone
--                           at a loading bay, short enough that a code left in
--                           an inbox is not a standing credential.
--   Attempts  5           — six digits is 10^6; five guesses is 5 in a million,
--                           and a sixth chance is the difference between a
--                           control and a formality.
--   Resends   3, then a 30-minute cooldown — resend is the free retry that
--                           turns an attempt limit into no limit at all.
--
-- ── WHY sha256 AND NOT ARGON2 ──────────────────────────────────────────────
-- The secret is six digits with a ten-minute life and a five-attempt cap. A
-- slow KDF defends against offline brute force of a stolen hash, and an
-- attacker who has this table already has the tenant's documents. What matters
-- is CONSTANT-TIME comparison, which is where the timing leak would actually
-- be, and that lives in services/signatures/otp.js.
--
-- Idempotent. Re-runnable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS signature_otp (
  otp_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Exactly one of these. An external party's challenge, or an internal
  -- signer's step-up (Q9 = C) — never both, and never neither.
  party_id       uuid REFERENCES signature_party(party_id) ON DELETE CASCADE,
  user_id        uuid REFERENCES app_user(user_id),

  entity_ref     text NOT NULL,
  -- Binds the code to ONE payload. See the header.
  content_hash   text NOT NULL,
  -- The address actually used, snapshotted: the certificate prints it, and a
  -- contact record edited a year later must not rewrite the evidence.
  sent_to        citext NOT NULL,
  code_hash      text NOT NULL,

  attempts       smallint NOT NULL DEFAULT 0,
  resends        smallint NOT NULL DEFAULT 0,
  expires_at     timestamptz NOT NULL,
  cooldown_until timestamptz,
  verified_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Unaligned on purpose — see 10781's note on the idempotency checker's regex.
CREATE INDEX IF NOT EXISTS ix_otp_party ON signature_otp(party_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_otp_user ON signature_otp(user_id, created_at DESC);

DO $$
BEGIN
  -- Exactly one subject. `num_nonnulls` rather than two OR'd IS NULL tests,
  -- because the latter reads as though a third state were possible.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_otp_subject' AND conrelid = 'signature_otp'::regclass) THEN
    ALTER TABLE signature_otp ADD CONSTRAINT ck_otp_subject
      CHECK (num_nonnulls(party_id, user_id) = 1);
  END IF;

  -- The caps, at the database. The service enforces them first and returns a
  -- usable error; this is what remains true if a future endpoint forgets to ask.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_otp_attempts' AND conrelid = 'signature_otp'::regclass) THEN
    ALTER TABLE signature_otp ADD CONSTRAINT ck_otp_attempts
      CHECK (attempts >= 0 AND attempts <= 5);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_otp_resends' AND conrelid = 'signature_otp'::regclass) THEN
    ALTER TABLE signature_otp ADD CONSTRAINT ck_otp_resends
      CHECK (resends >= 0 AND resends <= 3);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The back-link from PR-1's table. document_signature.otp_challenge_id has
-- existed since 10771 with no constraint behind it, because the table it points
-- at did not exist until now. With this in place, the ck_sig_external_verified
-- constraint 10771 already carries ("an external signature must name an OTP")
-- points at a row that provably exists.
-- ---------------------------------------------------------------------------
/*
 * Every pg_constraint lookup below is scoped with `conrelid = '<table>'::regclass`.
 * `pg_constraint` is DATABASE-wide and a tenant database holds both the live and
 * the sandbox schema, so an unscoped check finds the OTHER schema's constraint
 * and skips its own — silently. That is what left every tenant's sandbox with no
 * constraints on document_signature after PR-1, and it is gated now by
 * tests/security/signature-migration-scoping.test.js.
 */
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sig_otp' AND conrelid = 'document_signature'::regclass) THEN
    ALTER TABLE document_signature ADD CONSTRAINT fk_sig_otp
      FOREIGN KEY (otp_challenge_id) REFERENCES signature_otp(otp_id);
  END IF;
END $$;

COMMENT ON TABLE signature_otp IS
  'One emailed code. Bound to (subject, entity_ref, content_hash) so a code verifies ONE payload — doc/SIGNATURE_ENGINEERING_GUIDE.md §6.4.';
COMMENT ON COLUMN signature_otp.content_hash IS
  'MUST. Without it a code issued for one document could be replayed against another in the same window.';
COMMENT ON COLUMN signature_otp.sent_to IS
  'The address the code actually went to, snapshotted for the Certificate of Completion. Never re-derived from a contact record.';

-- ============================================================================
-- VERIFY
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'signature_otp' ORDER BY column_name;   -- expect 12
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'signature_otp'::regclass AND contype = 'c' ORDER BY conname;
--     -- expect ck_otp_attempts, ck_otp_resends, ck_otp_subject
--   SELECT conname FROM pg_constraint WHERE conname = 'fk_sig_otp';
--
-- DOWN
--   -- DESTRUCTIVE: drops the identity evidence behind every external
--   -- signature. The signatures survive; what a dispute turns on does not.
--   -- Take a dump first.
--   -- ALTER TABLE document_signature DROP CONSTRAINT IF EXISTS fk_sig_otp;
--   -- DROP TABLE IF EXISTS signature_otp;
-- ============================================================================
