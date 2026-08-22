-- ============================================================================
-- TENANT DB — 10779 The verification-scan log.
--
-- Every resolve of a printed QR or a typed verification code lands here.
-- doc/SIGNATURE_ENGINEERING_GUIDE.md §5.3, §5.5.
--
-- ── NUMBERING ──────────────────────────────────────────────────────────────
-- The guide reserved 10775–10776 for PR-2. Both were taken by the mail
-- programme (10775_mail_ai_feature_flag, 10776_mail_ocr_flag) while this
-- chapter was being written, and 10777–10778 went the same way. The
-- high-water mark was re-checked immediately before this file was created, as
-- §3.9 instructs, and check-migration-numbers.js is the hard gate that proves
-- it. PR-1 paid for this lesson once already.
--
-- ── WHY A TABLE AND NOT JUST THE LEDGER ────────────────────────────────────
-- Every scan is ALSO written to immutable_ledger (§5.5 step 2), and that copy
-- is the evidentiary one: append-only, tamper-evident, never pruned by this
-- feature. This table is the queryable projection. Two things need it and the
-- ledger cannot serve either without a jsonb scan of the whole audit history:
--
--   1. "has this IP scanned this signature before?" — one indexed lookup per
--      resolve, on the request path (§5.5 step 3).
--   2. "how many scans on this signature in the last rolling hour?" — the
--      anomaly window (§5.5 step 4).
--
-- It is also the only one of the two that may be PRUNED. `ip` is personal data
-- and carries a retention period the tenant sets
-- (signature_policy.scan_retention_days, default 400 — seeded in 10773); the
-- ledger keeps its own record under its own rules.
--
-- ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
-- No tenant/user column: a scan is anonymous by definition. The visitor holds
-- a piece of paper, not an account, and asking who they are would be both
-- impossible and the wrong question. `is_new_ip` is the closest this comes to
-- identity, and it is a boolean about a network, not a person.
--
-- Idempotent. Re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- REPAIR FIRST: make sure document_signature actually has its primary key.
--
-- 10771 guarded every constraint it adds with an UNSCOPED
-- `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = …)`.
-- `pg_constraint` is DATABASE-wide, and a tenant database holds BOTH schemas.
-- Provisioning migrates live first, so during the SANDBOX pass every one of
-- those checks found LIVE's constraint and skipped its own — leaving the
-- sandbox schema with no primary key and no check constraints on
-- document_signature. Nothing failed; the DO blocks did as they were told.
--
-- It surfaced here, because the FOREIGN KEY below is the first thing in the
-- programme to REQUIRE that key: provisioning stopped with "there is no unique
-- constraint matching given keys for referenced table document_signature",
-- sandbox pass only.
--
-- 10771 is fixed at source, which settles it for every future provision. This
-- block settles it for a tenant that already applied the broken version — that
-- migration is recorded as applied and will never re-run for them, so the
-- repair has to live in a file that has not run yet. This is that file.
--
-- Every check below is scoped with `conrelid = '<table>'::regclass`, which
-- resolves through search_path and therefore means "in the schema this
-- migration is running in". That is the form the rest of migrations/tenant
-- uses (0493, 0650, 0682) and the form this programme uses from here on.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'document_signature'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE document_signature ADD CONSTRAINT document_signature_pkey PRIMARY KEY (signature_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sig_assurance' AND conrelid = 'document_signature'::regclass) THEN
    ALTER TABLE document_signature ADD CONSTRAINT ck_sig_assurance
      CHECK (assurance_level IN ('SES','AES_OTP','QES','WET'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sig_mark' AND conrelid = 'document_signature'::regclass) THEN
    ALTER TABLE document_signature ADD CONSTRAINT ck_sig_mark
      CHECK (visual_mark IN ('STAMP','DRAWN','PROVIDER','INK'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sig_party' AND conrelid = 'document_signature'::regclass) THEN
    ALTER TABLE document_signature ADD CONSTRAINT ck_sig_party
      CHECK (party IN ('INTERNAL','EXTERNAL'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sig_identity_source' AND conrelid = 'document_signature'::regclass) THEN
    ALTER TABLE document_signature ADD CONSTRAINT ck_sig_identity_source
      CHECK ((identity_source = 'SESSION'  AND signer_user_id IS NOT NULL)
          OR (identity_source = 'DECLARED' AND signer_user_id IS NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sig_mark_payload' AND conrelid = 'document_signature'::regclass) THEN
    ALTER TABLE document_signature ADD CONSTRAINT ck_sig_mark_payload
      CHECK ((visual_mark = 'DRAWN' AND mark_image_b64 IS NOT NULL)
          OR (visual_mark IN ('STAMP','PROVIDER','INK')));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sig_external_verified' AND conrelid = 'document_signature'::regclass) THEN
    ALTER TABLE document_signature ADD CONSTRAINT ck_sig_external_verified
      CHECK (party = 'INTERNAL'
          OR assurance_level IN ('QES','WET')
          OR otp_challenge_id IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sig_revocation' AND conrelid = 'document_signature'::regclass) THEN
    ALTER TABLE document_signature ADD CONSTRAINT ck_sig_revocation
      CHECK ((revoked_at IS NULL AND revoked_by IS NULL)
          OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS signature_scan (
  scan_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ON DELETE CASCADE: a signature row is never deleted in normal operation
  -- (revocation sets a triple; see 10771), so this fires only when a tenant is
  -- being torn down — and a scan of a signature that no longer exists is not a
  -- record anybody can act on.
  signature_id  uuid NOT NULL REFERENCES document_signature(signature_id) ON DELETE CASCADE,
  scanned_at    timestamptz NOT NULL DEFAULT now(),
  -- PERSONAL DATA. Masked on the public portal (services/signatures/mask.js),
  -- never printed on the seal, pruned past scan_retention_days. §3.13.
  ip            inet,
  user_agent    text,
  referrer      text,
  via           text NOT NULL,
  is_new_ip     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Written unaligned on purpose: the idempotency checker's guard is
-- CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS), and a greedy \s+
-- backtracks over alignment padding until the lookahead stops seeing the
-- IF NOT EXISTS — so an aligned `CREATE INDEX      IF NOT EXISTS` is reported
-- as unsafe when it is not. Same note as 10771.
-- The scan tab on the signature detail: newest first, one signature at a time.
CREATE INDEX IF NOT EXISTS ix_scan_sig ON signature_scan(signature_id, scanned_at DESC);
-- The rolling-hour anomaly window: ascending, because the query is a range
-- count (scanned_at > now() - interval '1 hour') and not a "latest N".
CREATE INDEX IF NOT EXISTS ix_scan_window ON signature_scan(signature_id, scanned_at);
-- The new-IP check runs on EVERY resolve, before the row is inserted. Without
-- this it is a sequential scan of every scan ever recorded for the signature.
CREATE INDEX IF NOT EXISTS ix_scan_sig_ip ON signature_scan(signature_id, ip);
-- The retention sweep deletes by age across all signatures, so it needs an
-- index that does not lead with signature_id.
CREATE INDEX IF NOT EXISTS ix_scan_age ON signature_scan(scanned_at);

DO $$
BEGIN
  -- `via` records HOW the visitor arrived: 'QR' (the camera followed the
  -- printed symbol) or 'CODE' (they typed the twelve characters at /verify).
  -- The distinction is worth keeping: a document being verified by typed code
  -- has usually been read down a phone line, which is a different story from
  -- one scanned at a border post.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_scan_via' AND conrelid = 'signature_scan'::regclass) THEN
    ALTER TABLE signature_scan ADD CONSTRAINT ck_scan_via CHECK (via IN ('QR','CODE'));
  END IF;
END $$;

COMMENT ON TABLE signature_scan IS
  'One row per successful public verification of a signature. Queryable projection of the immutable_ledger copy; prunable past signature_policy.scan_retention_days. doc/SIGNATURE_ENGINEERING_GUIDE.md §5.5.';
COMMENT ON COLUMN signature_scan.ip IS
  'Personal data. Masked on the public portal, never printed, pruned past signature_policy.scan_retention_days.';
COMMENT ON COLUMN signature_scan.is_new_ip IS
  'True when no earlier scan of this signature came from this address. Drives document_signature.scanned_new_ip.';

-- ============================================================================
-- VERIFY
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'signature_scan' ORDER BY column_name;   -- expect 9
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'signature_scan'::regclass AND contype = 'c';  -- ck_scan_via
--   SELECT indexname FROM pg_indexes WHERE tablename = 'signature_scan';
--     -- expect ix_scan_age, ix_scan_sig, ix_scan_sig_ip, ix_scan_window
--   -- The repair, in BOTH schemas:
--   SELECT conname, contype FROM pg_constraint
--    WHERE conrelid = 'document_signature'::regclass ORDER BY conname;
--     -- expect the primary key plus all seven ck_sig_* checks
--
-- DOWN
--   -- DESTRUCTIVE: drops the queryable scan history. The immutable_ledger copy
--   -- survives, so the evidentiary record is not lost — but the portal's
--   -- new-IP detection and the anomaly window both go dark until it is rebuilt.
--   -- DROP TABLE IF EXISTS signature_scan;
-- ============================================================================
