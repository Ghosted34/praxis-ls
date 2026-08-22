-- ============================================================================
-- TENANT DB — 10781 The signature request: one document, one chain of parties,
-- one snapshotted payload.
--
-- doc/SIGNATURE_ENGINEERING_GUIDE.md §6.2.
--
-- ── NUMBERING ──────────────────────────────────────────────────────────────
-- The guide reserved 10746–10749, then 10777–10780. Both ranges were taken by
-- other programmes before this chapter was written, and PR-2 took 10779–10780.
-- The high-water mark was re-checked against main immediately before this file
-- was created, as §3.9 instructs. That check is now the third time it has paid
-- for itself.
--
-- ── THE ONE IDEA THIS TABLE EXISTS FOR ─────────────────────────────────────
-- `content_hash` is SNAPSHOTTED at creation and every signing act recomputes
-- and compares (§1.3(a)). Without it, party A signs an invoice for 1 607 900,
-- somebody edits a line, and party B countersigns 1 812 400 believing they are
-- agreeing to the same document A did. Both signatures would verify against
-- their own moment and the chain would be a lie.
--
-- On mismatch the request goes to AMENDED, every pending party is barred, every
-- signed party is notified, and a compliance_flag is raised. Reissuing mints a
-- NEW request; a request is never reopened, because "reopened" is
-- indistinguishable from "the figures moved while nobody was looking".
--
-- Idempotent. Re-runnable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS signature_request (
  request_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_ref        text NOT NULL,
  doc_type          text NOT NULL,
  document_vault_id uuid REFERENCES document_vault(doc_id),

  -- Snapshotted at creation. THE comparison every signing act makes. §1.3(a).
  payload_version   integer NOT NULL DEFAULT 1,
  content_hash      text NOT NULL,

  -- Funnel level 3 (Q16), stored as the RESOLVED preset list rather than as the
  -- sender's two booleans: the booleans are an input, and storing an input
  -- means re-deriving the answer at every read from a tenant menu that may have
  -- changed underneath it.
  allowed_presets   text[] NOT NULL,

  status            text NOT NULL DEFAULT 'DRAFT',
  message           text,
  expires_at        timestamptz,
  completed_at      timestamptz,

  created_by        uuid NOT NULL REFERENCES app_user(user_id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Unaligned on purpose: the idempotency checker's guard is
-- CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS), and a greedy \s+
-- backtracks over alignment padding until the lookahead stops seeing the
-- IF NOT EXISTS. Same note as 10771 and 10779.
CREATE INDEX IF NOT EXISTS ix_sigreq_entity ON signature_request(entity_ref);
-- Partial: the scheduler and the dashboard both ask "what is still open?", and
-- the open set stays small while the table grows without bound.
CREATE INDEX IF NOT EXISTS ix_sigreq_open ON signature_request(status)
  WHERE status IN ('SENT','PARTIALLY_SIGNED');
CREATE INDEX IF NOT EXISTS ix_sigreq_creator ON signature_request(created_by, created_at DESC);

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
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sigreq_status' AND conrelid = 'signature_request'::regclass) THEN
    ALTER TABLE signature_request ADD CONSTRAINT ck_sigreq_status
      CHECK (status IN ('DRAFT','SENT','PARTIALLY_SIGNED','COMPLETED',
                        'DECLINED','EXPIRED','AMENDED','VOIDED'));
  END IF;

  -- A completed request must say when. The certificate is generated on that
  -- transition and dates itself from this column, so a COMPLETED row with no
  -- timestamp would produce an undatable evidence document.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sigreq_completed' AND conrelid = 'signature_request'::regclass) THEN
    ALTER TABLE signature_request ADD CONSTRAINT ck_sigreq_completed
      CHECK ((status = 'COMPLETED' AND completed_at IS NOT NULL)
          OR (status <> 'COMPLETED' AND completed_at IS NULL));
  END IF;

  -- An empty menu is a request nobody can sign. Caught here rather than at the
  -- signing page, where the counterparty is the one who finds out.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sigreq_presets' AND conrelid = 'signature_request'::regclass) THEN
    ALTER TABLE signature_request ADD CONSTRAINT ck_sigreq_presets
      CHECK (array_length(allowed_presets, 1) >= 1);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sigreq_updated') THEN
    CREATE TRIGGER trg_sigreq_updated BEFORE UPDATE ON signature_request
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The back-link from PR-1's table. The column has existed since 10771 with no
-- constraint behind it, deliberately: 10771 shipped alone and the table it
-- points at did not exist yet.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sig_request' AND conrelid = 'document_signature'::regclass) THEN
    ALTER TABLE document_signature ADD CONSTRAINT fk_sig_request
      FOREIGN KEY (signature_request_id) REFERENCES signature_request(request_id);
  END IF;
END $$;

COMMENT ON TABLE signature_request IS
  'One signing chain over one document. content_hash is snapshotted at creation and re-compared on every signing act — doc/SIGNATURE_ENGINEERING_GUIDE.md §1.3(a).';
COMMENT ON COLUMN signature_request.content_hash IS
  'The canonical hash AS AT CREATION. A signing act that recomputes a different value moves the request to AMENDED and bars every pending party.';
COMMENT ON COLUMN signature_request.allowed_presets IS
  'Funnel level 3 — the sender''s narrowing, already resolved against the tenant menu and the doc-type ceiling.';

-- ============================================================================
-- VERIFY
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'signature_request' ORDER BY column_name;   -- expect 14
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'signature_request'::regclass AND contype = 'c' ORDER BY conname;
--     -- expect ck_sigreq_completed, ck_sigreq_presets, ck_sigreq_status
--   SELECT conname FROM pg_constraint WHERE conname = 'fk_sig_request';
--
-- DOWN
--   -- DESTRUCTIVE: drops every open and completed signing chain. The
--   -- document_signature rows survive (they are the evidence); what is lost is
--   -- the record of who was ASKED and in what order.
--   -- ALTER TABLE document_signature DROP CONSTRAINT IF EXISTS fk_sig_request;
--   -- DROP TABLE IF EXISTS signature_request;
-- ============================================================================
