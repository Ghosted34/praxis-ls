-- ============================================================================
-- TENANT DB — 10771 Signature core: reshape document_signature into the table
-- every signature passes through.
--
-- The stub created by 0410_notifications_ux.sql could record that somebody
-- signed something. It could not record who proved they were, what exactly they
-- attested to, whether the document has changed since, or how a stranger
-- holding the paper is meant to check any of it.
--
-- Full rationale: doc/SIGNATURE_ENGINEERING_GUIDE.md §4.2. The three ideas that
-- shape the result:
--
--   1. TWO HASHES, NOT ONE (guide §3.6, Q2).
--      content_hash  = sha256 of the canonical BUSINESS payload. Recomputable
--                      from the live record at any later date, which is what
--                      makes "has this document changed since it was signed?"
--                      an answerable question.
--      artifact_hash = sha256 of the vaulted PDF bytes. Frozen. Answers a
--                      different question: "is this the exact file we issued?"
--      The stub hashed rendered bytes only — and since the QR has to be INSIDE
--      those bytes, that hash could never be printed on the document it
--      described. That circularity is why no Praxis PDF has ever been
--      verifiable: template.service.js passes the renderer a verify string with
--      no hash in it, because there is none to pass.
--
--   2. TWO AXES, NOT FOUR TIERS (guide §3.3, Q1).
--      assurance_level = what identity evidence was collected.
--      visual_mark     = what the mark looks like.
--      The product still says "Tier 1..4" out loud; signature_preset (10772)
--      maps that vocabulary onto the axes.
--
--   3. THE PAYLOAD IS STORED, NOT JUST HASHED (guide §5.4, Q12).
--      content_payload holds the canonical struct itself. The public portal
--      renders the document AS SIGNED from this column rather than querying the
--      live record — otherwise a March waybill scanned in September would show
--      September's figures to whoever is holding March's paper.
--
-- WHY ALTER AND NOT DROP + CREATE
--   A second CREATE TABLE for a table 0410 already declares is the exact hazard
--   scripts/db/check-schema-drift.js exists to catch: with IF NOT EXISTS the
--   earlier file wins and the later one is a silent no-op. 0410 is frozen in the
--   idempotency baseline and must not be edited, so the correct resolution — and
--   the one that checker documents — is to reshape the existing table in place.
--
-- Idempotent. Re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Refuse to reshape a table that holds data.
--
-- A tenant that actually used the old endpoint has rows worth a deliberate
-- migration, and silently dropping `method` / `signature_ref` would destroy the
-- only record that somebody signed something. Fail loudly; the deployer decides.
-- ---------------------------------------------------------------------------
DO $$
DECLARE n bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'document_signature' AND column_name = 'signature_ref'
  ) THEN
    EXECUTE 'SELECT count(*) FROM document_signature' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION
        'document_signature holds % row(s) from the 0410 stub. Migrate or archive them before running 10771 — see doc/SIGNATURE_ENGINEERING_GUIDE.md §4.2.', n;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Retire the stub's columns.
--
-- DESTRUCTIVE: drops document_signature_id, method and signature_ref. Guarded by
-- the empty-table check above, so nothing can be lost without the migration
-- first refusing to run. `method` ('DIGITAL'|'PHYSICAL') is superseded by the
-- assurance_level x visual_mark pair; `signature_ref` was an untyped free-text
-- pointer with no defined contract.
-- ---------------------------------------------------------------------------
-- DESTRUCTIVE: drops the stub's surrogate key, superseded by signature_id.
ALTER TABLE document_signature DROP COLUMN IF EXISTS document_signature_id;
-- DESTRUCTIVE: drops method ('DIGITAL'|'PHYSICAL') — superseded by assurance_level x visual_mark; table verified empty above.
ALTER TABLE document_signature DROP COLUMN IF EXISTS method;
-- DESTRUCTIVE: drops signature_ref, an untyped pointer with no contract; table verified empty above.
ALTER TABLE document_signature DROP COLUMN IF EXISTS signature_ref;

-- ---------------------------------------------------------------------------
-- 2. The new shape. One statement per column: the drift checker reads
--    ALTER TABLE … ADD COLUMN one match at a time, and a combined statement
--    would register only its first column.
-- ---------------------------------------------------------------------------
ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS signature_id uuid;
UPDATE document_signature SET signature_id = gen_random_uuid() WHERE signature_id IS NULL;
ALTER TABLE document_signature ALTER COLUMN signature_id SET DEFAULT gen_random_uuid();
-- The backfill above gives every row a key, so this cannot fail on existing data.
-- DESTRUCTIVE: SET NOT NULL rejects a NULL row — none can exist after that UPDATE.
ALTER TABLE document_signature ALTER COLUMN signature_id SET NOT NULL;

ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS doc_type text;
ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS payload_version integer NOT NULL DEFAULT 1;
ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS content_payload jsonb;
ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS artifact_hash text;
ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS assurance_level text;
ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS visual_mark text;
ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS preset_code text;
ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS sign_reason text;
ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS party text;
ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS identity_source text;
ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS signer_role text;
ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS signer_email citext;
ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS signature_request_id uuid;
ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS mark_image_b64 text;
ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS verify_code text;
ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS ip inet;
ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS otp_challenge_id uuid;
ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES app_user(user_id);
ALTER TABLE document_signature ADD COLUMN IF NOT EXISTS revoke_reason text;

-- ---------------------------------------------------------------------------
-- 3. Tighten what the stub left loose. The table is empty (step 0 guarantees
--    it), so these cannot fail on existing data.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_signature_pkey') THEN
    ALTER TABLE document_signature ADD CONSTRAINT document_signature_pkey PRIMARY KEY (signature_id);
  END IF;
END $$;

-- DESTRUCTIVE: SET NOT NULL — a signature with no document type cannot be verified against anything; table verified empty above.
ALTER TABLE document_signature ALTER COLUMN doc_type SET NOT NULL;
-- DESTRUCTIVE: SET NOT NULL — the hash IS the attestation; without it there is nothing to recompute; table verified empty above.
ALTER TABLE document_signature ALTER COLUMN content_hash SET NOT NULL;
-- DESTRUCTIVE: SET NOT NULL — the portal renders the as-signed summary from this column; table verified empty above.
ALTER TABLE document_signature ALTER COLUMN content_payload SET NOT NULL;
-- DESTRUCTIVE: SET NOT NULL — a signature that cannot say what evidence backs it is not evidence; table verified empty above.
ALTER TABLE document_signature ALTER COLUMN assurance_level SET NOT NULL;
-- DESTRUCTIVE: SET NOT NULL — every signature renders a mark; there is no unmarked case; table verified empty above.
ALTER TABLE document_signature ALTER COLUMN visual_mark SET NOT NULL;
-- DESTRUCTIVE: SET NOT NULL — internal and external signatures carry different rules throughout; table verified empty above.
ALTER TABLE document_signature ALTER COLUMN party SET NOT NULL;
-- DESTRUCTIVE: SET NOT NULL — distinguishes a claimed name from a session-resolved one; table verified empty above.
ALTER TABLE document_signature ALTER COLUMN identity_source SET NOT NULL;
-- DESTRUCTIVE: SET NOT NULL — the seal prints it; a nameless signature attests to nobody; table verified empty above.
ALTER TABLE document_signature ALTER COLUMN signer_name SET NOT NULL;
-- DESTRUCTIVE: SET NOT NULL — without it the printed QR resolves to nothing; table verified empty above.
ALTER TABLE document_signature ALTER COLUMN verify_code SET NOT NULL;
-- DESTRUCTIVE: SET NOT NULL — the timestamp is part of the evidentiary claim; table verified empty above.
ALTER TABLE document_signature ALTER COLUMN signed_at SET NOT NULL;
ALTER TABLE document_signature ALTER COLUMN signed_at       SET DEFAULT now();

-- Written without column alignment on purpose: the idempotency checker's guard
-- is CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS), and a greedy \s+
-- backtracks over padding until the lookahead stops seeing the IF NOT EXISTS —
-- so an aligned `CREATE INDEX      IF NOT EXISTS` is reported as unsafe when it
-- is not.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sig_code ON document_signature(verify_code);
CREATE INDEX IF NOT EXISTS ix_sig_entity ON document_signature(entity_ref, signed_at DESC);
CREATE INDEX IF NOT EXISTS ix_sig_doc ON document_signature(document_vault_id);
CREATE INDEX IF NOT EXISTS ix_sig_signer ON document_signature(signer_user_id);
CREATE INDEX IF NOT EXISTS ix_sig_request ON document_signature(signature_request_id);

-- ---------------------------------------------------------------------------
-- 4. Constraints that make invalid states unrepresentable rather than merely
--    discouraged. Each is a rule the guide states in prose; putting it here
--    means no service, worker or future endpoint can get it wrong.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sig_assurance') THEN
    ALTER TABLE document_signature ADD CONSTRAINT ck_sig_assurance
      CHECK (assurance_level IN ('SES','AES_OTP','QES','WET'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sig_mark') THEN
    ALTER TABLE document_signature ADD CONSTRAINT ck_sig_mark
      CHECK (visual_mark IN ('STAMP','DRAWN','PROVIDER','INK'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sig_party') THEN
    ALTER TABLE document_signature ADD CONSTRAINT ck_sig_party
      CHECK (party IN ('INTERNAL','EXTERNAL'));
  END IF;

  -- A session-resolved identity must carry the user it came from; a declared
  -- one must not (the signer is not an app_user).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sig_identity_source') THEN
    ALTER TABLE document_signature ADD CONSTRAINT ck_sig_identity_source
      CHECK ((identity_source = 'SESSION'  AND signer_user_id IS NOT NULL)
          OR (identity_source = 'DECLARED' AND signer_user_id IS NULL));
  END IF;

  -- A drawn mark needs its image; the other three marks are generated.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sig_mark_payload') THEN
    ALTER TABLE document_signature ADD CONSTRAINT ck_sig_mark_payload
      CHECK ((visual_mark = 'DRAWN' AND mark_image_b64 IS NOT NULL)
          OR (visual_mark IN ('STAMP','PROVIDER','INK')));
  END IF;

  -- External signers ALWAYS clear an OTP. There is no threshold and no setting
  -- that disables it, so it belongs below the service layer. QES and WET are
  -- excepted because their evidence comes from elsewhere: a third-party
  -- provider's identity check, or a barcode-reconciled wet signature.
  -- (guide §1.5(b))
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sig_external_verified') THEN
    ALTER TABLE document_signature ADD CONSTRAINT ck_sig_external_verified
      CHECK (party = 'INTERNAL'
          OR assurance_level IN ('QES','WET')
          OR otp_challenge_id IS NOT NULL);
  END IF;

  -- Revocation is all-or-nothing: a row claiming a revocation date must say who
  -- did it, so "revoked by nobody" cannot reach the portal.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sig_revocation') THEN
    ALTER TABLE document_signature ADD CONSTRAINT ck_sig_revocation
      CHECK ((revoked_at IS NULL AND revoked_by IS NULL)
          OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL));
  END IF;
END $$;

COMMENT ON TABLE  document_signature IS
  'Every signature in the tenant. One row per signing act; never updated except to revoke, never deleted. doc/SIGNATURE_ENGINEERING_GUIDE.md §4.';
COMMENT ON COLUMN document_signature.content_hash IS
  'sha256 of the canonical business payload. Recomputed on every read to detect amendment.';
COMMENT ON COLUMN document_signature.content_payload IS
  'The canonical payload itself, as signed. The public portal renders from this, never from the live record.';
COMMENT ON COLUMN document_signature.artifact_hash IS
  'sha256 of the vaulted PDF bytes. NULL until the document is rendered.';
COMMENT ON COLUMN document_signature.assurance_level IS
  'Evidence ACTUALLY collected, never what the preset requested.';
COMMENT ON COLUMN document_signature.verify_code IS
  'Public verification credential, plaintext. The QR encodes https://{host}/v/{code}.';
COMMENT ON COLUMN document_signature.ip IS
  'Captured at OTP verification. Never printed on the seal; masked on the public portal.';

-- ============================================================================
-- VERIFY
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'document_signature' ORDER BY column_name;
--     -- expect 29, and NO method / signature_ref / document_signature_id
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'document_signature'::regclass AND contype = 'c' ORDER BY conname;
--     -- expect ck_sig_assurance, ck_sig_external_verified, ck_sig_identity_source,
--     --        ck_sig_mark, ck_sig_mark_payload, ck_sig_party, ck_sig_revocation
--   SELECT indexname FROM pg_indexes WHERE tablename = 'document_signature';
--
-- DOWN
--   -- Returns the table to the 0410 stub shape. The signatures themselves are
--   -- NOT recoverable from it — the stub has nowhere to put a canonical payload,
--   -- an assurance level or a verify code — so take a dump first.
--   -- ALTER TABLE document_signature DROP CONSTRAINT IF EXISTS ck_sig_assurance;
--   -- ALTER TABLE document_signature DROP CONSTRAINT IF EXISTS ck_sig_mark;
--   -- ALTER TABLE document_signature DROP CONSTRAINT IF EXISTS ck_sig_party;
--   -- ALTER TABLE document_signature DROP CONSTRAINT IF EXISTS ck_sig_identity_source;
--   -- ALTER TABLE document_signature DROP CONSTRAINT IF EXISTS ck_sig_mark_payload;
--   -- ALTER TABLE document_signature DROP CONSTRAINT IF EXISTS ck_sig_external_verified;
--   -- ALTER TABLE document_signature DROP CONSTRAINT IF EXISTS ck_sig_revocation;
--   -- DROP INDEX IF EXISTS uq_sig_code, ix_sig_entity, ix_sig_doc, ix_sig_signer, ix_sig_request;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS doc_type;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS payload_version;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS content_payload;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS artifact_hash;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS assurance_level;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS visual_mark;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS preset_code;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS sign_reason;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS party;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS identity_source;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS signer_role;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS signer_email;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS signature_request_id;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS mark_image_b64;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS verify_code;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS ip;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS user_agent;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS otp_challenge_id;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS revoked_at;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS revoked_by;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS revoke_reason;
--   -- ALTER TABLE document_signature DROP COLUMN IF EXISTS signature_id;
--   -- ALTER TABLE document_signature ADD COLUMN document_signature_id uuid PRIMARY KEY DEFAULT gen_random_uuid();
--   -- ALTER TABLE document_signature ADD COLUMN method text NOT NULL DEFAULT 'DIGITAL';
--   -- ALTER TABLE document_signature ADD COLUMN signature_ref text;
-- ============================================================================
