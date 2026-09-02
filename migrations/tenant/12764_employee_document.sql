-- ============================================================================
-- TENANT DB — 12764 employee_document: the ID card, the CV, the signed contract.
--
-- ── THE GAP ────────────────────────────────────────────────────────────────
--
-- Clients have `client_document`. Suppliers have `supplier_document`. Corporate
-- entities have `entity_document`. All three (0511, 0516) carry the same shape:
-- a typed row with a number, an issuing authority, an issue date, an expiry, a
-- link to the scan in `document_vault`, and separate scan/verification states.
--
-- Employees had nothing. The one population whose paperwork actually EXPIRES —
-- a CNI, a residence permit, a driving licence, a medical certificate — was the
-- one with nowhere to record an expiry date. HR kept the CNI in a drawer and
-- the system could not answer "whose ID lapses this quarter".
--
-- This is the fourth instance of that same model, deliberately identical to
-- `entity_document` so the renewals engine, the party-360 document panel and
-- everything else built against that shape can be pointed here without being
-- rewritten.
--
-- ── A SCAN IS A VERIFICATION GATE, NOT A CREATION GATE ─────────────────────
--
-- Repeated from 0516 because it is the rule people break: a row MAY be saved
-- paper-only, with a `physical_ref` and scan_status = 'PENDING'. Refusing to
-- record a national ID card you are physically holding because the scanner is
-- down is how a staff register ends up incomplete — and an incomplete register
-- is worse than one with a few unscanned rows, because nobody trusts it.
--
-- The employee-creation wizard therefore never blocks on an upload. It records
-- what it was given and reports what is outstanding
-- (employees.documents.checklist), and CONTRACT GENERATION is what refuses to
-- run without the documents a contract needs.
--
-- ── WHY THE TYPES LIVE IN party_document_type ──────────────────────────────
--
-- A second registry table would mean a second Settings screen, a second set of
-- severities and a second thing to keep in step. `party_document_type.applies_to`
-- already discriminates CLIENT / SUPPLIER / BOTH, and the compliance rules
-- filter on it strictly (`compliance.rules.appliesToParty`), so an 'EMPLOYEE'
-- value is invisible to client and supplier evaluation while reusing the whole
-- registry — expiry requirements, issuing-authority requirements, severities.
-- ============================================================================

-- ── 1. Teach the registry about employees ──────────────────────────────────
--
-- THE FULL SET, RESTATED. `applies_to` has been widened once already: 0511
-- created it as CLIENT/SUPPLIER/BOTH and 0516 added ENTITY and ALL, and 28
-- seeded rows use ENTITY today. Adding EMPLOYEE by re-creating the constraint
-- from the ORIGINAL three values drops those on the floor, and the ALTER then
-- fails against any real database with `is violated by some row` — which is
-- exactly what a replay against Postgres caught before this shipped.
--
-- So the list here is the whole current set plus one, and the drop names the
-- constraint rather than searching for it — same shape as 0516's own widening,
-- which is what makes both of them re-runnable. Anyone widening it again should
-- copy this block and add to the list, not restate a remembered subset.
DO $$
BEGIN
  ALTER TABLE party_document_type DROP CONSTRAINT IF EXISTS party_document_type_applies_to_check;
  ALTER TABLE party_document_type
    ADD CONSTRAINT party_document_type_applies_to_check
    CHECK (applies_to IN ('CLIENT','SUPPLIER','BOTH','ENTITY','ALL','EMPLOYEE'));
END $$;

-- The staff file. `requires_expiry` is what drives the renewals warning, so it
-- is true exactly where the document really does lapse: an ID card and a work
-- permit do, a CV and a birth certificate do not.
INSERT INTO party_document_type (code, name, applies_to, is_system, requires_expiry, requires_issuing_authority, default_severity) VALUES
  ('EMP_ID_CARD',        'National ID card (CNI) / Passport', 'EMPLOYEE', true,  true,  true,  'ESCALATED'),
  ('EMP_CV',             'Curriculum vitae',                  'EMPLOYEE', true,  false, false, 'INFO'),
  ('EMP_SIGNED_CONTRACT','Signed employment contract',        'EMPLOYEE', true,  false, false, 'ESCALATED'),
  ('EMP_DIPLOMA',        'Diploma / certificate',             'EMPLOYEE', true,  false, true,  'INFO'),
  ('EMP_BIRTH_CERT',     'Birth certificate',                 'EMPLOYEE', true,  false, true,  'INFO'),
  ('EMP_CRIMINAL_RECORD','Criminal record extract',           'EMPLOYEE', true,  true,  true,  'WARN'),
  ('EMP_MEDICAL',        'Medical certificate of fitness',    'EMPLOYEE', true,  true,  true,  'WARN'),
  ('EMP_CNPS',           'CNPS registration',                 'EMPLOYEE', true,  false, true,  'ESCALATED'),
  ('EMP_BANK_RIB',       'Bank RIB / account proof',          'EMPLOYEE', true,  false, false, 'WARN'),
  ('EMP_WORK_PERMIT',    'Work / residence permit',           'EMPLOYEE', true,  true,  true,  'ESCALATED'),
  ('EMP_DRIVING_LICENCE','Driving licence',                   'EMPLOYEE', true,  true,  true,  'WARN'),
  ('EMP_PHOTO',          'Passport photograph',               'EMPLOYEE', true,  false, false, 'INFO'),
  ('EMP_OTHER',          'Other staff document',              'EMPLOYEE', false, false, false, 'INFO')
ON CONFLICT (code) DO NOTHING;

-- ── 2. The documents themselves ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_document (
  document_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         uuid NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
  document_type_id    uuid REFERENCES party_document_type(document_type_id),
  title               text,
  document_number     text,
  issuing_authority   text,
  issued_on           date,
  expires_on          date,
  country_code        char(2),

  vault_id            uuid REFERENCES document_vault(doc_id),   -- digital scan
  scan_status         text NOT NULL DEFAULT 'PENDING'
      CHECK (scan_status IN ('PENDING','SCANNED','VERIFIED','REJECTED','EXPIRED')),
  physical_ref        text,                                     -- archive/box reference
  scan_due_on         date,
  verification_status text NOT NULL DEFAULT 'PENDING'
      CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED','EXPIRED')),
  verified_by         uuid REFERENCES app_user(user_id),
  verified_at         timestamptz,
  rejection_reason    text,
  content_hash        text,
  version_no          int NOT NULL DEFAULT 1,
  renewal_lead_days   int,
  is_active           boolean NOT NULL DEFAULT true,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES app_user(user_id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on)
);

CREATE INDEX IF NOT EXISTS ix_employee_doc_employee ON employee_document(employee_id, document_type_id);
CREATE INDEX IF NOT EXISTS ix_employee_doc_expires  ON employee_document(expires_on) WHERE expires_on IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_employee_doc_scan     ON employee_document(scan_status);

CREATE OR REPLACE TRIGGER trg_employee_document_updated
  BEFORE UPDATE ON employee_document
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE employee_document IS
  'Staff file: ID card, CV, signed contract, diplomas. Same shape as entity_document (0516) on purpose. A scan is a verification gate, not a creation gate — a paper-only row is valid.';

-- DOWN
--   DROP TABLE IF EXISTS employee_document;
--   DELETE FROM party_document_type WHERE applies_to = 'EMPLOYEE';
--   ALTER TABLE party_document_type DROP CONSTRAINT IF EXISTS party_document_type_applies_to_check;
--   ALTER TABLE party_document_type ADD CONSTRAINT party_document_type_applies_to_check
--     CHECK (applies_to IN ('CLIENT','SUPPLIER','BOTH','ENTITY','ALL'));   -- 0516's set
