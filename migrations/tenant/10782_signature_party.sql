-- ============================================================================
-- TENANT DB — 10782 The chain: who signs, in what order, and where their
-- address came from.
--
-- doc/SIGNATURE_ENGINEERING_GUIDE.md §6.2, §6.3 (Q7).
--
-- ── THE RULE THIS TABLE ENFORCES IN THE DATABASE, NOT THE VALIDATOR ────────
-- At most ONE manually-entered signatory per request. Everyone else comes from
-- the tenant's own records — client_master contacts, app_user rows, the
-- dossier contact — and carries a source_ref saying exactly which row.
--
-- The cap is a PARTIAL UNIQUE INDEX. A validator check exists too, for the
-- friendly error, but a validator is a thing a later endpoint can forget to
-- call: an import path, a bulk create, an AI action. The index is the thing
-- that makes the rule true, and §6.9 criterion 1 asserts the CONSTRAINT fires,
-- not the validator.
--
-- ── WHAT A SIGNER MAY NEVER TOUCH ─────────────────────────────────────────
-- The email. Q7 = C is forbidden outright: there is no code path in this
-- programme where a signer supplies the address their own OTP is sent to. They
-- may state their NAME and ROLE (that is `identity_source = 'DECLARED'`, and
-- the portal and certificate both say the name is CLAIMED while the email is
-- PROVED — §1.3(d)). If the address is wrong the sender reissues, which is
-- exactly the audit behaviour worth having.
--
-- Idempotent. Re-runnable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS signature_party (
  party_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id          uuid NOT NULL REFERENCES signature_request(request_id) ON DELETE CASCADE,
  sequence_no         smallint NOT NULL,
  party_kind          text NOT NULL,

  -- Q7: where this address came from, and who stands behind it.
  source              text NOT NULL,
  source_ref          text,
  override_by_user_id uuid REFERENCES app_user(user_id),
  override_reason     text,

  full_name           text NOT NULL,
  party_role          text,
  email               citext NOT NULL,
  language            text,

  allowed_presets     text[] NOT NULL,
  status              text NOT NULL DEFAULT 'PENDING',
  decline_reason      text,

  -- The signing credential. A DIFFERENT secret from verify_code, stored
  -- differently for a different reason (§3.7): a leaked verify code shows
  -- somebody a summary the tenant chose to publish; a leaked sign token IS a
  -- forged signature. So this one is peppered and the plaintext is emailed once
  -- and never stored.
  sign_token_hmac     text,
  sign_expires_at     timestamptz,

  sent_at             timestamptz,
  viewed_at           timestamptz,
  settled_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Unaligned on purpose — see 10781's note on the idempotency checker's regex.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sigparty_token ON signature_party(sign_token_hmac)
  WHERE sign_token_hmac IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sigparty_seq ON signature_party(request_id, sequence_no);
CREATE INDEX IF NOT EXISTS ix_sigparty_open ON signature_party(request_id, status);
-- The reminder scheduler sweeps by age across every request, so it needs an
-- index that does not lead with request_id.
CREATE INDEX IF NOT EXISTS ix_sigparty_reminder ON signature_party(status, sent_at)
  WHERE status IN ('SENT','VIEWED');

-- Q7, in the database. A second OVERRIDE on one request fails here.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sigparty_one_override ON signature_party(request_id)
  WHERE source = 'OVERRIDE';

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
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sigparty_kind' AND conrelid = 'signature_party'::regclass) THEN
    ALTER TABLE signature_party ADD CONSTRAINT ck_sigparty_kind
      CHECK (party_kind IN ('ISSUER','COUNTERPARTY','WITNESS'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sigparty_source' AND conrelid = 'signature_party'::regclass) THEN
    ALTER TABLE signature_party ADD CONSTRAINT ck_sigparty_source
      CHECK (source IN ('ON_FILE','OVERRIDE'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sigparty_status' AND conrelid = 'signature_party'::regclass) THEN
    ALTER TABLE signature_party ADD CONSTRAINT ck_sigparty_status
      CHECK (status IN ('PENDING','SENT','VIEWED','SIGNED','DECLINED','EXPIRED'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sigparty_language' AND conrelid = 'signature_party'::regclass) THEN
    ALTER TABLE signature_party ADD CONSTRAINT ck_sigparty_language
      CHECK (language IS NULL OR language IN ('fr','en'));
  END IF;

  -- An OVERRIDE must name who authorised it and why. An ON_FILE party must
  -- not: "authorised by nobody" and "authorised by somebody we did not record"
  -- would be indistinguishable, and the certificate prints this field as the
  -- reason a reader should weigh the address differently.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sigparty_override_attributed' AND conrelid = 'signature_party'::regclass) THEN
    ALTER TABLE signature_party ADD CONSTRAINT ck_sigparty_override_attributed
      CHECK ((source = 'OVERRIDE' AND override_by_user_id IS NOT NULL AND override_reason IS NOT NULL)
          OR (source = 'ON_FILE'  AND override_by_user_id IS NULL));
  END IF;

  -- A signing order starts at 1. A chain with a party at 0 or -1 sorts
  -- correctly and reads as though somebody signed before the request existed.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sigparty_sequence' AND conrelid = 'signature_party'::regclass) THEN
    ALTER TABLE signature_party ADD CONSTRAINT ck_sigparty_sequence
      CHECK (sequence_no >= 1);
  END IF;

  -- A declined party must say why. The creator is notified with the reason,
  -- and "declined, no reason given" is not a message anybody can act on.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sigparty_decline' AND conrelid = 'signature_party'::regclass) THEN
    ALTER TABLE signature_party ADD CONSTRAINT ck_sigparty_decline
      CHECK (status <> 'DECLINED' OR decline_reason IS NOT NULL);
  END IF;

  -- A token without an expiry is a permanent signing credential. The two
  -- columns are set together or not at all.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sigparty_token_expiry' AND conrelid = 'signature_party'::regclass) THEN
    ALTER TABLE signature_party ADD CONSTRAINT ck_sigparty_token_expiry
      CHECK (num_nonnulls(sign_token_hmac, sign_expires_at) <> 1);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sigparty_presets' AND conrelid = 'signature_party'::regclass) THEN
    ALTER TABLE signature_party ADD CONSTRAINT ck_sigparty_presets
      CHECK (array_length(allowed_presets, 1) >= 1);
  END IF;
END $$;

COMMENT ON TABLE signature_party IS
  'One signatory in one chain. At most one OVERRIDE per request, enforced by uq_sigparty_one_override — doc/SIGNATURE_ENGINEERING_GUIDE.md §6.3.';
COMMENT ON COLUMN signature_party.source IS
  'ON_FILE: pulled from the tenant''s own records, with source_ref naming the row. OVERRIDE: typed by a tenant user, attributed to them. Never supplied by the signer.';
COMMENT ON COLUMN signature_party.email IS
  'Where the OTP goes. NEVER writable by the signer (Q7 = C is forbidden). The signing page renders it masked and read-only.';
COMMENT ON COLUMN signature_party.sign_token_hmac IS
  'HMAC-SHA256 under SIGNATURE_TOKEN_PEPPER. The plaintext is emailed once and never stored. NULL until the party is dispatched.';

-- ============================================================================
-- VERIFY
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'signature_party' ORDER BY column_name;   -- expect 21
--   SELECT indexname FROM pg_indexes WHERE tablename = 'signature_party';
--     -- expect uq_sigparty_one_override among them
--   -- The Q7 cap, proved:
--   --   INSERT two OVERRIDE parties on one request → 23505 unique_violation.
--
-- DOWN
--   -- DESTRUCTIVE: drops every chain's membership. Signatures already written
--   -- survive in document_signature; what is lost is who was asked and why an
--   -- address was trusted — which is most of the certificate's evidence.
--   -- DROP TABLE IF EXISTS signature_party;
-- ============================================================================
