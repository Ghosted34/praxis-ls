-- ============================================================================
-- TENANT DB — 10784 The Certificate of Completion: its doc type, its events,
-- and the reminder bookkeeping the scheduler needs.
--
-- doc/SIGNATURE_ENGINEERING_GUIDE.md §6.7, §6.8.
--
-- ── WHY THE CERTIFICATE IS A DOC TYPE AND NOT A REPORT ────────────────────
-- Read §2.2 first. With no PAdES seal, this document plus the immutable_ledger
-- trail is the ENTIRE evidentiary case. Registering it as a doc type means it
-- goes through the same pipeline as every other document — rendered by the
-- template registry, captured into document_vault, hashed like any artifact,
-- and downloadable through the same gated route. An evidence document that
-- lived outside the vault would be the one document in the system with no
-- content hash and no audit trail of its own.
--
-- ── IT IS GENERATED ONCE ───────────────────────────────────────────────────
-- A regenerated certificate produces different bytes (Puppeteer stamps
-- /CreationDate) and therefore a different artifact hash, so two "copies" of
-- one certificate would disagree about their own fingerprint. The job is
-- idempotent on request_id: `certificate_doc_id` below is where that
-- idempotency lives, and a second run returns the existing vault row.
--
-- Every pg_constraint lookup is scoped with `conrelid = '…'::regclass` — see
-- 10779's header for the bug that taught this programme why.
--
-- Idempotent. Re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Where the generated certificate lands, and the idempotency key.
-- ---------------------------------------------------------------------------
ALTER TABLE signature_request ADD COLUMN IF NOT EXISTS certificate_doc_id uuid REFERENCES document_vault(doc_id);
-- Reminder bookkeeping. Kept on the REQUEST rather than the party because the
-- rule is "two nudges per party, then silence" and the count has to survive a
-- party being re-sent; per-party counters live in signature_party.sent_at plus
-- this stamp, which is what the scheduler compares against.
ALTER TABLE signature_request ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz;
ALTER TABLE signature_request ADD COLUMN IF NOT EXISTS reminder_count smallint NOT NULL DEFAULT 0;

DO $$
BEGIN
  -- Two nudges maximum, then silence — a third email teaches people to filter
  -- you. The scheduler enforces it; this makes it true of the data as well.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sigreq_reminders' AND conrelid = 'signature_request'::regclass) THEN
    ALTER TABLE signature_request ADD CONSTRAINT ck_sigreq_reminders
      CHECK (reminder_count >= 0 AND reminder_count <= 2);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_sigreq_certificate ON signature_request(certificate_doc_id)
  WHERE certificate_doc_id IS NOT NULL;

COMMENT ON COLUMN signature_request.certificate_doc_id IS
  'The vaulted Certificate of Completion. Set once, on the final signature. A second generation run returns this row rather than producing different bytes — doc/SIGNATURE_ENGINEERING_GUIDE.md §6.7.';

-- ---------------------------------------------------------------------------
-- 2. The events.
--
-- `document_signature.*`, not `signature.*`, for the reason 10774 recorded:
-- the mail programme owns the `signature.*` prefix for EMAIL signatures, and
-- shared/notifications/categories.js keys on the prefix.
--
-- NOTE: no semicolons inside the seed strings. The idempotency checker finds a
-- statement by slicing between semicolons without tracking quotes.
-- ---------------------------------------------------------------------------
INSERT INTO event_type (key, module_key, name, description) VALUES
  ('document_signature.requested',  'MOD-64', 'Signature requested',
   'A signing chain was created over a document. The canonical hash is snapshotted at this moment and every later signing act is compared against it.'),
  ('document_signature.dispatched', 'MOD-64', 'Signature link sent',
   'A party was sent their signing link. Refused while an ISSUER party at sequence 1 is still unsigned — a counterparty must never be asked to countersign a document the issuing company has not signed.'),
  ('document_signature.viewed',     'MOD-64', 'Signing page opened',
   'A party opened their signing link. Recorded once, on first view.'),
  ('document_signature.declined',   'MOD-64', 'Signature declined',
   'A party declined with a reason. Earlier signatures in the chain remain valid records of what those parties attested to.'),
  ('document_signature.completed',  'MOD-64', 'Signing chain completed',
   'Every party has signed. The Certificate of Completion is generated on this transition.'),
  ('document_signature.certificate_issued', 'MOD-64', 'Certificate of Completion issued',
   'The evidence document for a completed chain was rendered and vaulted. Generated once — a regenerated certificate would carry a different artifact hash.'),
  ('document_signature.reminded',   'MOD-64', 'Signature reminder sent',
   'A pending party was nudged. Two per request, then silence.'),
  ('document_signature.expired',    'MOD-64', 'Signature request expired',
   'The request passed its expiry with parties still pending.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. The reason vocabulary the signing page offers a DECLINING party.
--
-- Free text on a decline is the same liability as free text on a seal (§3.12):
-- somebody eventually types something that contradicts the document it sits
-- on, or names a person. The list is short, bilingual and tenant-editable
-- through the same table the signing reasons already use — one catalogue, one
-- settings screen, one place a tenant renames a phrase.
--
-- `kind` is what keeps the two lists apart. It defaults to 'SIGN' so every row
-- 10772 seeded keeps its meaning without a backfill.
-- ---------------------------------------------------------------------------
ALTER TABLE signature_reason ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'SIGN';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_sigreason_kind' AND conrelid = 'signature_reason'::regclass) THEN
    ALTER TABLE signature_reason ADD CONSTRAINT ck_sigreason_kind
      CHECK (kind IN ('SIGN','DECLINE'));
  END IF;
END $$;

INSERT INTO signature_reason (reason_code, label_en, label_fr, sort_order, is_active, kind) VALUES
  ('DECLINE_FIGURES_WRONG',  'The figures are not what we agreed',  'Les montants ne correspondent pas à ce qui a été convenu', 10, true, 'DECLINE'),
  ('DECLINE_NOT_AUTHORISED', 'I am not authorised to sign this',    'Je ne suis pas habilité à signer ce document',             20, true, 'DECLINE'),
  ('DECLINE_WRONG_DOCUMENT', 'This is not the document I expected', 'Ce n''est pas le document attendu',                        30, true, 'DECLINE'),
  ('DECLINE_TERMS',          'I do not accept the terms',           'Je n''accepte pas les conditions',                         40, true, 'DECLINE'),
  ('DECLINE_OTHER',          'Another reason',                      'Autre motif',                                              50, true, 'DECLINE')
ON CONFLICT (reason_code) DO NOTHING;

-- ============================================================================
-- VERIFY
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'signature_request'
--      AND column_name IN ('certificate_doc_id','last_reminder_at','reminder_count');
--     -- expect 3
--   SELECT key FROM event_type WHERE key LIKE 'document_signature.%' ORDER BY key;
--     -- expect 12 (4 from 10774, 2 from 10780, 8 here — 8 new)
--   SELECT reason_code, kind FROM signature_reason ORDER BY kind, sort_order;
--     -- expect 5 SIGN (10772) + 5 DECLINE
--
-- DOWN
--   -- DESTRUCTIVE: drops the link to every issued certificate. The vault rows
--   -- survive and are still downloadable by doc_id, but nothing joins them
--   -- back to the request they prove.
--   -- ALTER TABLE signature_request DROP COLUMN IF EXISTS certificate_doc_id;
--   -- ALTER TABLE signature_request DROP COLUMN IF EXISTS last_reminder_at;
--   -- ALTER TABLE signature_request DROP COLUMN IF EXISTS reminder_count;
--   -- DELETE FROM signature_reason WHERE kind = 'DECLINE';
--   -- ALTER TABLE signature_reason DROP COLUMN IF EXISTS kind;
--   -- DELETE FROM event_type WHERE key IN
--   --   ('document_signature.requested','document_signature.dispatched','document_signature.viewed',
--   --    'document_signature.declined','document_signature.completed',
--   --    'document_signature.certificate_issued','document_signature.reminded','document_signature.expired');
-- ============================================================================
