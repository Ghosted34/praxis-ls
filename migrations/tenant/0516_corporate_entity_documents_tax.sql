-- ============================================================================
-- TENANT DB — 0516 corporate entity master revamp (MOD-01), part 2 of 2.
--
-- 0512 established WHO an entity legally is. This establishes what it FILES,
-- what it HOLDS, and what it PRINTS:
--
--   §1-3  administrative documents (statutes, tax clearance, licences) on the
--         existing document_vault, with expiry tracking that feeds the renewal
--         engine rather than a filing cabinet nobody opens;
--   §4-5  per-entity tax registrations — the missing link that lets one group be
--         compliant in Cameroon and France at once;
--   §6    banking: `treasury_account` becomes the single source of truth and the
--         entity's `bank_block` jsonb is retired;
--   §7    the letterhead/footer configuration the document renderer reads.
--
-- WHY DOCUMENTS ARE NOT JUST document_vault ROWS. The vault gives content
-- hashing, versioning and QR resolution — it is the FILE layer. What it does not
-- carry is which document type this is, when it was issued, when it expires, by
-- which authority, and where the paper original is filed. Those are what make a
-- document governable, and they are what the renewal engine reads. Same split
-- 0511 chose for client_document.
--
-- WHY TAX REGISTRATIONS ARE HERE AND RATE CARDS ARE NOT. Cameroon's TVA rate is a
-- fact about Cameroon and lives in `tax_code`, effective-dated, in MOD-07 — a
-- Finance Law is a new version, never an overwrite. "SLAS France is VAT-registered
-- as FR123…, files monthly, normal regime" is a fact about OUR ENTITY in that
-- jurisdiction, and until now had nowhere to live. Duplicating rate cards per
-- entity would mean entering the same Finance Law twice and watching them drift.
--
-- OBLIGATIONS REUSE tax_calendar. 0342 already created a per-entity compliance
-- calendar ("drives reminders/alerts"). Rather than a parallel table, §5 binds it
-- to the registration that generates each obligation.
--
-- NOTHING HARD-BLOCKS. Rules raise INFO / WARN / ESCALATED /
-- SOFT_BLOCK_RECOMMENDATION. HARD_BLOCK stays a human action through an explicit
-- endpoint, exactly as 0511 established for parties.
--
-- ADDITIVE ONLY. Idempotent — safe to re-run. SCHEMA-DUAL: runs UNQUALIFIED,
-- once per schema (live, then sandbox).
-- ============================================================================

-- ── 1. Widen the document-type registry to cover our own entities ──────────
-- `party_document_type` is already a table rather than an enum, precisely so
-- that "what counts as a document" is configuration. Widening `applies_to` costs
-- one CHECK and reuses the registry, its severity ladder and its expiry flags.
ALTER TABLE party_document_type DROP CONSTRAINT IF EXISTS party_document_type_applies_to_check;
ALTER TABLE party_document_type ADD CONSTRAINT party_document_type_applies_to_check
  CHECK (applies_to IN ('CLIENT','SUPPLIER','BOTH','ENTITY','ALL'));

-- How far ahead of expiry this KIND of document starts warning. A customs bond
-- that takes six weeks to renew must warn earlier than a licence that takes two
-- days, and that difference is data about the document type, not a per-document
-- decision an operator should have to remember. A document may still override it.
ALTER TABLE party_document_type
  ADD COLUMN IF NOT EXISTS renewal_lead_days int
    CHECK (renewal_lead_days IS NULL OR (renewal_lead_days BETWEEN 0 AND 365));

-- ── 2. Seed the entity document catalogue ──────────────────────────────────
-- Universal core, then the freight-forwarding licences this tenant actually
-- needs, then the EU set. `requires_expiry` drives the renewal engine;
-- `default_severity` is how loudly a missing one complains — and note that none
-- of them is HARD_BLOCK, because no rule writes that.
INSERT INTO party_document_type
  (code, name, applies_to, is_system, requires_expiry, requires_issuing_authority, default_severity) VALUES
  -- Constitutional
  ('CERT_INCORPORATION',   'Certificate of Incorporation',            'ENTITY', true, false, true,  'ESCALATED'),
  ('ARTICLES',             'Articles of Association / Statuts',       'ENTITY', true, false, false, 'ESCALATED'),
  ('TRADE_REGISTER',       'Trade Register Extract (RCCM / K-bis)',   'ENTITY', true, true,  true,  'ESCALATED'),
  ('SHAREHOLDER_REGISTER', 'Register of Shareholders',                'ENTITY', true, false, false, 'WARN'),
  ('BOARD_RESOLUTION',     'Board Resolution / Signatory Mandate',    'ENTITY', true, true,  false, 'WARN'),
  ('UBO_DECLARATION',      'Beneficial Ownership Declaration',        'ENTITY', true, true,  false, 'ESCALATED'),
  -- Tax and social
  ('TAX_REGISTRATION',     'Tax Registration Certificate (NIU / VAT)','ENTITY', true, false, true,  'ESCALATED'),
  ('TAX_CLEARANCE',        'Tax Clearance (Attestation de non-redevance)', 'ENTITY', true, true, true, 'SOFT_BLOCK_RECOMMENDATION'),
  ('SOCIAL_SECURITY_REG',  'Social Security Registration (CNPS / URSSAF)', 'ENTITY', true, true, true, 'ESCALATED'),
  ('BUSINESS_LICENCE',     'Business Licence (Patente)',              'ENTITY', true, true,  true,  'SOFT_BLOCK_RECOMMENDATION'),
  ('AUDITED_ACCOUNTS',     'Audited Financial Statements',            'ENTITY', true, true,  false, 'WARN'),
  -- Premises, banking, cover
  ('OFFICE_LEASE',         'Registered Office Lease or Title Deed',   'ENTITY', true, true,  false, 'WARN'),
  ('BANK_ATTESTATION',     'Bank Attestation / RIB',                  'ENTITY', true, false, true,  'WARN'),
  ('INSURANCE_POLICY',     'Insurance Policy (liability, cargo, fleet)','ENTITY', true, true, true,  'ESCALATED'),
  -- Freight forwarding: what actually stops us operating if it lapses
  ('CUSTOMS_BROKER_LICENCE','Customs Broker / Transitaire Licence',   'ENTITY', true, true,  true,  'SOFT_BLOCK_RECOMMENDATION'),
  ('CUSTOMS_BOND',         'Customs Bond / Caution en douane',        'ENTITY', true, true,  true,  'SOFT_BLOCK_RECOMMENDATION'),
  ('TRANSPORT_LICENCE',    'Transport Operating Licence',             'ENTITY', true, true,  true,  'ESCALATED'),
  ('FREIGHT_FORWARDER_LICENCE','Freight Forwarder Licence',           'ENTITY', true, true,  true,  'ESCALATED'),
  ('IATA_AGENT',           'IATA Cargo Agent Accreditation',          'ENTITY', true, true,  true,  'WARN'),
  ('FIATA_MEMBERSHIP',     'FIATA Membership',                        'ENTITY', true, true,  true,  'WARN'),
  ('AEO_CERTIFICATE',      'AEO / Trusted Trader Certificate',        'ENTITY', true, true,  true,  'WARN'),
  ('WAREHOUSE_LICENCE',    'Bonded Warehouse Licence',                'ENTITY', true, true,  true,  'ESCALATED'),
  ('SHIPPING_AGENCY_LICENCE','Shipping Agency Licence',               'ENTITY', true, true,  true,  'WARN'),
  ('DANGEROUS_GOODS_CERT', 'Dangerous Goods Handling Certificate',    'ENTITY', true, true,  true,  'WARN'),
  -- EU / cross-border
  ('EORI_CERTIFICATE',     'EORI Certificate',                        'ENTITY', true, false, true,  'ESCALATED'),
  ('VAT_CERTIFICATE',      'Intra-community VAT Certificate',         'ENTITY', true, true,  true,  'ESCALATED'),
  ('POWER_OF_ATTORNEY_ENT','Power of Attorney',                       'ENTITY', true, true,  false, 'WARN'),
  ('OTHER_ENTITY',         'Other',                                   'ENTITY', true, false, false, 'INFO')
ON CONFLICT (code) DO NOTHING;

-- Lead times reflect how long each renewal actually takes to obtain, not how
-- important it is — severity already carries importance. A customs bond involves
-- a bank guarantee and an authority; a bank attestation is same-week.
UPDATE party_document_type SET renewal_lead_days = v.days
  FROM (VALUES
    ('CUSTOMS_BOND', 90), ('CUSTOMS_BROKER_LICENCE', 90), ('AEO_CERTIFICATE', 120),
    ('WAREHOUSE_LICENCE', 90), ('TRANSPORT_LICENCE', 60), ('FREIGHT_FORWARDER_LICENCE', 60),
    ('INSURANCE_POLICY', 45), ('TAX_CLEARANCE', 30), ('BUSINESS_LICENCE', 45),
    ('SOCIAL_SECURITY_REG', 30), ('IATA_AGENT', 60), ('FIATA_MEMBERSHIP', 45),
    ('AUDITED_ACCOUNTS', 60), ('OFFICE_LEASE', 90), ('TRADE_REGISTER', 45),
    ('VAT_CERTIFICATE', 45), ('DANGEROUS_GOODS_CERT', 60), ('SHIPPING_AGENCY_LICENCE', 60),
    ('BOARD_RESOLUTION', 30), ('POWER_OF_ATTORNEY_ENT', 30), ('UBO_DECLARATION', 30)
  ) AS v(code, days)
 WHERE party_document_type.code = v.code
   AND party_document_type.renewal_lead_days IS DISTINCT FROM v.days;

-- ── 3. entity_document ─────────────────────────────────────────────────────
-- Mirrors client_document, including the scan gate from 0511's Hard Rule 9: a
-- row MAY be saved paper-only with a `physical_ref` and scan_status='PENDING'.
-- The digital scan is a VERIFICATION gate, not a CREATION gate — refusing to
-- record a document you are holding in your hand because it has not been
-- scanned yet is how a register ends up incomplete and untrusted.
CREATE TABLE IF NOT EXISTS entity_document (
  document_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id           uuid NOT NULL REFERENCES corporate_entity(entity_id) ON DELETE CASCADE,
  document_type_id    uuid REFERENCES party_document_type(document_type_id),
  title               text,
  document_number     text,
  issuing_authority   text,
  issued_on           date,
  expires_on          date,
  -- Which country/registration this document evidences. A group holding the same
  -- document type in two jurisdictions (a tax clearance in CM and one in FR)
  -- needs them distinguishable, and the renewals list needs to say which.
  country_code        char(2),
  establishment_id    uuid REFERENCES entity_establishment(establishment_id) ON DELETE SET NULL,

  vault_id            uuid REFERENCES document_vault(doc_id),   -- digital scan
  scan_status         text NOT NULL DEFAULT 'PENDING'
      CHECK (scan_status IN ('PENDING','SCANNED','VERIFIED','REJECTED','EXPIRED')),
  physical_ref        text,                                      -- archive/box reference
  scan_due_on         date,
  verification_status text NOT NULL DEFAULT 'PENDING'
      CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED','EXPIRED')),
  verified_by         uuid REFERENCES app_user(user_id),
  verified_at         timestamptz,
  rejection_reason    text,
  content_hash        text,
  version_no          int NOT NULL DEFAULT 1,
  -- Renewal lead time in days. Null falls back to the engine's default, so a
  -- customs bond that takes six weeks to renew can warn earlier than a licence
  -- that takes two days, without a code change.
  renewal_lead_days   int,
  is_active           boolean NOT NULL DEFAULT true,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES app_user(user_id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on)
);
CREATE INDEX IF NOT EXISTS ix_entity_doc_entity  ON entity_document(entity_id, document_type_id);
CREATE INDEX IF NOT EXISTS ix_entity_doc_expires ON entity_document(expires_on) WHERE expires_on IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_entity_doc_scan    ON entity_document(scan_status);

-- ── 4. entity_tax_registration ─────────────────────────────────────────────
-- THE missing link. Until now `tax_jurisdiction` was tenant-global with no
-- entity_id, so there was nowhere to record that our Cameroon entity files TVA
-- monthly under the réel regime while our France entity files TVA under the
-- régime normal with an EORI. The rate cards stay in MOD-07 and are shared; what
-- is per-entity is the REGISTRATION and the OBLIGATION.
CREATE TABLE IF NOT EXISTS entity_tax_registration (
  tax_registration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id           uuid NOT NULL REFERENCES corporate_entity(entity_id) ON DELETE CASCADE,
  jurisdiction_id     uuid REFERENCES tax_jurisdiction(jurisdiction_id),
  country_code        char(2) NOT NULL,

  tax_kind            text NOT NULL DEFAULT 'VAT'
      CHECK (tax_kind IN ('VAT','INCOME','WHT','PAYROLL','CUSTOMS','LOCAL','OTHER')),
  tax_number          text,                       -- the VAT/TVA number as issued
  regime              text,                       -- 'REEL' | 'SIMPLIFIE' | 'NORMAL' | 'FRANCHISE'
  filing_frequency    text
      CHECK (filing_frequency IS NULL OR filing_frequency IN
        ('MONTHLY','QUARTERLY','ANNUAL','BIMONTHLY','ON_EVENT')),
  filing_due_day      smallint CHECK (filing_due_day IS NULL OR (filing_due_day BETWEEN 1 AND 31)),
  currency            char(3),

  -- Is this entity obliged to withhold tax on payments it makes in this
  -- jurisdiction? Drives supplier-invoice WHT computation.
  is_withholding_agent boolean NOT NULL DEFAULT false,
  -- Reverse charge / intra-community supply applies (EU).
  reverse_charge_applies boolean NOT NULL DEFAULT false,

  registered_on       date,
  deregistered_on     date,
  is_primary          boolean NOT NULL DEFAULT false,
  is_active           boolean NOT NULL DEFAULT true,
  filing_portal_url   text,
  responsible_user_id uuid REFERENCES app_user(user_id),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (deregistered_on IS NULL OR registered_on IS NULL OR deregistered_on >= registered_on)
);
CREATE INDEX IF NOT EXISTS ix_entity_taxreg_entity ON entity_tax_registration(entity_id, country_code);
CREATE INDEX IF NOT EXISTS ix_entity_taxreg_juris  ON entity_tax_registration(jurisdiction_id);

-- One active registration per (entity, country, tax kind). Two live VAT numbers
-- for the same entity in the same country is a data-entry error, and it would
-- make "which number goes on the invoice" unanswerable.
CREATE UNIQUE INDEX IF NOT EXISTS ux_entity_taxreg_active
  ON entity_tax_registration(entity_id, country_code, tax_kind)
  WHERE is_active AND deregistered_on IS NULL;

-- ── 5. Bind the existing obligation calendar to its registration ───────────
-- 0342 already built `tax_calendar` — "compliance calendar of statutory
-- obligations (drives reminders/alerts)". It just had no link to WHY an
-- obligation exists. This is the "prepared for C" half: once obligations are
-- generated from a registration's frequency and due-day, the calendar rows can
-- say which registration produced them, and a deregistration can retire them.
ALTER TABLE tax_calendar
  ADD COLUMN IF NOT EXISTS tax_registration_id uuid REFERENCES entity_tax_registration(tax_registration_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS period_code text,
  ADD COLUMN IF NOT EXISTS generated boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS ix_tax_calendar_reg ON tax_calendar(tax_registration_id);
-- The calendar predates this and only allowed PENDING/DONE/LATE. A generated
-- obligation that is superseded (registration closed, period reopened) needs a
-- resting state that is neither done nor late.
ALTER TABLE tax_calendar DROP CONSTRAINT IF EXISTS tax_calendar_status_check;
ALTER TABLE tax_calendar ADD CONSTRAINT tax_calendar_status_check
  CHECK (status IN ('PENDING','DONE','LATE','WAIVED','SUPERSEDED'));

-- ── 6. Banking: one source of truth ────────────────────────────────────────
-- `corporate_entity.bank_block` (jsonb, 0100) and `treasury_account` (0230) have
-- both claimed to hold "our bank details". The invoice payment block renders the
-- jsonb; the ledger posts to the GL-mapped account. Nothing kept them in step,
-- so an entity could invoice with account X while posting receipts to Y.
--
-- treasury_account wins: it carries the class-5 GL mapping, so it is the one
-- that has to be right. bank_block is frozen — still readable so historical
-- documents render unchanged, no longer written.
ALTER TABLE treasury_account
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false,
  -- Does this account appear in the payment block on this entity's documents?
  ADD COLUMN IF NOT EXISTS show_on_documents boolean NOT NULL DEFAULT false,
  -- The human-facing details a payment block needs that a GL mapping does not
  -- carry. Migrated out of bank_block below.
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS branch text,
  ADD COLUMN IF NOT EXISTS account_number text,
  ADD COLUMN IF NOT EXISTS iban text,
  ADD COLUMN IF NOT EXISTS swift_bic text,
  ADD COLUMN IF NOT EXISTS beneficiary_name text;

-- Which account the payment block leads with, when several are shown.
ALTER TABLE corporate_entity
  ADD COLUMN IF NOT EXISTS remittance_account_id uuid REFERENCES treasury_account(treasury_account_id);

-- Migrate each entity's bank_block into a treasury account. Only where the block
-- actually holds something and the entity has no bank account carrying those
-- details yet, so a re-run cannot duplicate. coa_code 521100 is the OHADA
-- "banques locales" account; the row is created inactive and flagged for review
-- rather than silently joining the GL, because an account nobody has confirmed
-- should not start receiving postings.
INSERT INTO treasury_account
  (entity_id, kind, label, coa_code, currency, is_active, show_on_documents, is_primary,
   bank_name, branch, account_number, iban, swift_bic)
SELECT
  e.entity_id, 'BANK',
  COALESCE(NULLIF(btrim(e.bank_block->>'bank_name'), ''), 'Imported bank account'),
  '521100',
  COALESCE(e.default_currency, 'XAF'),
  false, true, true,
  NULLIF(btrim(e.bank_block->>'bank_name'), ''),
  NULLIF(btrim(e.bank_block->>'branch'), ''),
  NULLIF(btrim(e.bank_block->>'account_number'), ''),
  NULLIF(btrim(e.bank_block->>'iban'), ''),
  NULLIF(btrim(e.bank_block->>'swift'), '')
FROM corporate_entity e
WHERE e.bank_block IS NOT NULL
  AND e.bank_block <> '{}'::jsonb
  AND COALESCE(
        NULLIF(btrim(e.bank_block->>'bank_name'), ''),
        NULLIF(btrim(e.bank_block->>'account_number'), ''),
        NULLIF(btrim(e.bank_block->>'iban'), '')) IS NOT NULL
  AND EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.code = '521100')
  AND NOT EXISTS (
    SELECT 1 FROM treasury_account t
     WHERE t.entity_id = e.entity_id
       AND (t.account_number IS NOT NULL OR t.iban IS NOT NULL OR t.bank_name IS NOT NULL));

-- Point the entity at the account it just produced, where it has none.
UPDATE corporate_entity e
   SET remittance_account_id = t.treasury_account_id
  FROM treasury_account t
 WHERE t.entity_id = e.entity_id
   AND t.show_on_documents
   AND e.remittance_account_id IS NULL;

COMMENT ON COLUMN corporate_entity.bank_block IS
  'FROZEN as of 0516. Historical payment blocks read it; nothing writes it. The
   source of truth for an entity''s bank details is treasury_account (MOD-09),
   which carries the class-5 GL mapping. See §6 of 0516.';

-- ── 7. Letterhead & footer configuration ───────────────────────────────────
-- What a document header and footer actually print. Two halves, deliberately:
--
--   DERIVED — legal form, share capital, registered office, tax identifiers.
--   Assembled from the fields 0512 already captures, so nobody retypes them and
--   they cannot go stale. `show_*` toggles decide which appear, because the
--   mandatory mentions differ by country: a French invoice must show the RCS,
--   share capital and VAT number plus late-payment wording; a Cameroonian one
--   must show the NIU and RCCM.
--
--   AUTHORED — the wording that cannot be derived, per language. `fr` and `en`
--   are separate columns rather than a jsonb blob so the document renderer can
--   select one without parsing, and so a missing translation is visible.
CREATE TABLE IF NOT EXISTS entity_letterhead (
  entity_id            uuid PRIMARY KEY REFERENCES corporate_entity(entity_id) ON DELETE CASCADE,

  -- Which derived blocks appear.
  show_legal_form      boolean NOT NULL DEFAULT true,
  show_share_capital   boolean NOT NULL DEFAULT true,
  show_registered_address boolean NOT NULL DEFAULT true,
  show_registrations   boolean NOT NULL DEFAULT true,
  show_contact         boolean NOT NULL DEFAULT true,
  show_bank_block      boolean NOT NULL DEFAULT true,
  show_establishment   boolean NOT NULL DEFAULT false,

  -- Authored wording, per language.
  header_note_fr       text,
  header_note_en       text,
  footer_note_fr       text,
  footer_note_en       text,
  -- Statutory small print: late-payment penalties, discount terms, jurisdiction
  -- clause. Separate from footer_note because it is legally load-bearing and
  -- tends to be written once by a lawyer and then left alone.
  legal_mentions_fr    text,
  legal_mentions_en    text,

  -- Presentation.
  brand_color          text,           -- '#C2703D'
  accent_color         text,
  logo_position        text NOT NULL DEFAULT 'LEFT' CHECK (logo_position IN ('LEFT','CENTER','RIGHT')),
  paper_size           text NOT NULL DEFAULT 'A4' CHECK (paper_size IN ('A4','LETTER')),
  header_height_mm     smallint,
  footer_height_mm     smallint,

  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES app_user(user_id)
);

-- Every existing entity gets a default configuration, so the designer opens on a
-- working letterhead rather than an empty form.
INSERT INTO entity_letterhead (entity_id)
SELECT entity_id FROM corporate_entity
ON CONFLICT (entity_id) DO NOTHING;

-- ── 8. updated_at triggers ─────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_entity_document_updated ON entity_document;
CREATE TRIGGER trg_entity_document_updated BEFORE UPDATE ON entity_document
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_entity_taxreg_updated ON entity_tax_registration;
CREATE TRIGGER trg_entity_taxreg_updated BEFORE UPDATE ON entity_tax_registration
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_entity_letterhead_updated ON entity_letterhead;
CREATE TRIGGER trg_entity_letterhead_updated BEFORE UPDATE ON entity_letterhead
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── DOWN ────────────────────────────────────────────────────────────────────
-- DOWN
-- Additive migration; reverse by dropping what it added. Commented so nothing
-- runs by accident, present so there is a starting point at 3am.
--
-- READ THE BANKING NOTE FIRST. §6 migrated each entity's `bank_block` jsonb into
-- a treasury_account row. `bank_block` was NOT cleared — it is frozen, not
-- emptied — so dropping the new columns restores the pre-0516 payment block
-- exactly. What is lost is any bank detail EDITED through Treasury since the
-- migration, because that edit lives on treasury_account and has no path back
-- into the jsonb. The imported rows are created inactive, so in the common case
-- (nobody activated one yet) nothing was ever read from them and the undo is
-- clean. If an account was activated and corrected, restore the pre-deploy dump
-- (scripts/deploy.sh takes one) rather than running this.
--
-- The imported treasury_account rows are deliberately NOT dropped below: by the
-- time anyone runs this they may carry ledger postings, and a row referenced by
-- journal_entry cannot be removed. Deactivate them instead.
--
-- DROP TRIGGER IF EXISTS trg_entity_document_updated ON entity_document;
-- DROP TRIGGER IF EXISTS trg_entity_taxreg_updated ON entity_tax_registration;
-- DROP TRIGGER IF EXISTS trg_entity_letterhead_updated ON entity_letterhead;
-- ALTER TABLE corporate_entity DROP COLUMN IF EXISTS remittance_account_id;
-- ALTER TABLE tax_calendar
--   DROP COLUMN IF EXISTS tax_registration_id,
--   DROP COLUMN IF EXISTS period_code,
--   DROP COLUMN IF EXISTS generated;
-- ALTER TABLE tax_calendar DROP CONSTRAINT IF EXISTS tax_calendar_status_check;
-- ALTER TABLE tax_calendar ADD CONSTRAINT tax_calendar_status_check
--   CHECK (status IN ('PENDING','DONE','LATE'));
-- DROP TABLE IF EXISTS entity_letterhead, entity_document, entity_tax_registration;
-- ALTER TABLE treasury_account
--   DROP COLUMN IF EXISTS is_primary,       DROP COLUMN IF EXISTS show_on_documents,
--   DROP COLUMN IF EXISTS bank_name,        DROP COLUMN IF EXISTS branch,
--   DROP COLUMN IF EXISTS account_number,   DROP COLUMN IF EXISTS iban,
--   DROP COLUMN IF EXISTS swift_bic,        DROP COLUMN IF EXISTS beneficiary_name;
-- ALTER TABLE party_document_type DROP COLUMN IF EXISTS renewal_lead_days;
-- DELETE FROM party_document_type WHERE applies_to = 'ENTITY' AND is_system;
-- ALTER TABLE party_document_type DROP CONSTRAINT IF EXISTS party_document_type_applies_to_check;
-- ALTER TABLE party_document_type ADD CONSTRAINT party_document_type_applies_to_check
--   CHECK (applies_to IN ('CLIENT','SUPPLIER','BOTH'));
-- UPDATE treasury_account SET is_active = false
--  WHERE label = 'Imported bank account' OR coa_code = '521100';  -- review before running
