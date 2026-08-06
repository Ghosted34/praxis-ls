-- ============================================================================
-- TENANT DB — 0510 party master data revamp (clients + suppliers, 360°).
--
-- Global-grade, compliance-first master data. Keeps client_master and
-- supplier_master SEPARATE (no unified `party` table by design), and extends
-- each with the identity, credit-control, screening and — for suppliers — AVL
-- scorecard fields the legacy Cameroon codebase carried plus the global fields a
-- multi-jurisdiction forwarder needs (tax residency, WHT certificates, EORI/VAT
-- registrations, beneficial owners for AML).
--
-- Adds the first-class child tables that were previously crammed into
-- `kyc_docs jsonb` / `bank_block jsonb`: registrations, documents, contacts,
-- addresses, bank accounts, beneficial owners — one pair per party (client_* /
-- supplier_*), because the two masters stay independent. Plus the dynamic
-- registries (supplier_type, party_document_type) and per-tenant field-config
-- (party_field_config) that make "what is required" configuration, not code.
--
-- ADDITIVE ONLY. Every change is `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF
-- NOT EXISTS`, a seed with `ON CONFLICT DO NOTHING`, or a widening of a CHECK.
-- Nothing is dropped; existing rows are untouched. Idempotent — safe to re-run.
--
-- SCHEMA-DUAL. Like every tenant migration this runs UNQUALIFIED, once per
-- schema (live, then sandbox), so all references resolve within the current
-- schema. See migrations/tenant/0001_extensions.sql and doc/DB_ARCHITECTURE.md.
--
-- The country_profile seed below is GENERATED from packages/shared/data/
-- countries.js (scripts/gen/gen-country-seed.js) so the table, the API and the
-- client's country picker cannot drift from one another.
-- ============================================================================

-- ── Compliance severity ladder ─────────────────────────────────────────────
-- The compliance engine (src/modules/master/compliance) issues a five-rung
-- ladder — INFO, WARN, ESCALATED, SOFT_BLOCK_RECOMMENDATION, HARD_BLOCK — while
-- 0340 only allowed INFO/WARN/RED. Widen the CHECK to accept both sets: RED is
-- kept for the existing GL-integrity flags, the four new rungs are added. A rule
-- never writes HARD_BLOCK (only POST /:id/block does, by a human) but the value
-- is allowed so the manual block can be recorded on the same table.
ALTER TABLE compliance_flag DROP CONSTRAINT IF EXISTS compliance_flag_severity_check;
ALTER TABLE compliance_flag ADD CONSTRAINT compliance_flag_severity_check
  CHECK (severity IN ('INFO','WARN','RED','ESCALATED','SOFT_BLOCK_RECOMMENDATION','HARD_BLOCK'));

-- ── 2.1 Extend client_master ───────────────────────────────────────────────
ALTER TABLE client_master
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS trading_name text,
  ADD COLUMN IF NOT EXISTS registration_status text
      CHECK (registration_status IS NULL OR registration_status IN
        ('DRAFT','PENDING_REVIEW','ACTIVE','SUSPENDED','DEACTIVATED','ARCHIVED')),
  ADD COLUMN IF NOT EXISTS compliance_state text
      CHECK (compliance_state IS NULL OR compliance_state IN
        ('OK','WARN','ESCALATED','SOFT_BLOCK_RECOMMENDATION','HARD_BLOCK')),
  ADD COLUMN IF NOT EXISTS hard_blocked_by uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS hard_blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS hard_block_reason text,
  ADD COLUMN IF NOT EXISTS coa_aux_account text REFERENCES chart_of_accounts(code),
  ADD COLUMN IF NOT EXISTS linked_supplier_id uuid REFERENCES supplier_master(supplier_id),
  ADD COLUMN IF NOT EXISTS risk_tier text,
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS verification_status text,
  ADD COLUMN IF NOT EXISTS deactivation_reason text,
  ADD COLUMN IF NOT EXISTS tax_residency_country char(2),
  ADD COLUMN IF NOT EXISTS default_currency char(3) DEFAULT 'XAF',
  ADD COLUMN IF NOT EXISTS default_language char(2) DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS preferred_channel text,
  ADD COLUMN IF NOT EXISTS relationship_manager_user_id uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS credit_insured boolean,
  ADD COLUMN IF NOT EXISTS credit_insurance_ref text,
  ADD COLUMN IF NOT EXISTS credit_insurance_expires_on date,
  ADD COLUMN IF NOT EXISTS guarantee_amount numeric(18,2),
  ADD COLUMN IF NOT EXISTS deposit_amount numeric(18,2),
  ADD COLUMN IF NOT EXISTS advance_required boolean,
  ADD COLUMN IF NOT EXISTS advance_required_percent numeric(5,2),
  ADD COLUMN IF NOT EXISTS screened_at timestamptz,
  ADD COLUMN IF NOT EXISTS screen_status text,
  ADD COLUMN IF NOT EXISTS screen_reference text;

-- ── 2.5 supplier_type registry (create before supplier_master references it) ─
CREATE TABLE IF NOT EXISTS supplier_type (
  supplier_type_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             citext UNIQUE NOT NULL,
  name             text NOT NULL,
  is_system        boolean NOT NULL DEFAULT false,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── 2.2 Extend supplier_master ─────────────────────────────────────────────
ALTER TABLE supplier_master
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS trading_name text,
  ADD COLUMN IF NOT EXISTS registration_status text
      CHECK (registration_status IS NULL OR registration_status IN
        ('DRAFT','PENDING_REVIEW','ACTIVE','SUSPENDED','DEACTIVATED','ARCHIVED')),
  ADD COLUMN IF NOT EXISTS compliance_state text
      CHECK (compliance_state IS NULL OR compliance_state IN
        ('OK','WARN','ESCALATED','SOFT_BLOCK_RECOMMENDATION','HARD_BLOCK')),
  ADD COLUMN IF NOT EXISTS hard_blocked_by uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS hard_blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS hard_block_reason text,
  ADD COLUMN IF NOT EXISTS coa_aux_account text REFERENCES chart_of_accounts(code),
  ADD COLUMN IF NOT EXISTS linked_client_id uuid REFERENCES client_master(client_id),
  ADD COLUMN IF NOT EXISTS risk_tier text,
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS verification_status text,
  ADD COLUMN IF NOT EXISTS deactivation_reason text,
  ADD COLUMN IF NOT EXISTS evaluation_notes text,
  ADD COLUMN IF NOT EXISTS tax_residency_country char(2),
  ADD COLUMN IF NOT EXISTS default_currency char(3) DEFAULT 'XAF',
  ADD COLUMN IF NOT EXISTS default_language char(2) DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS preferred_channel text,
  ADD COLUMN IF NOT EXISTS relationship_manager_user_id uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS screened_at timestamptz,
  ADD COLUMN IF NOT EXISTS screen_status text,
  ADD COLUMN IF NOT EXISTS screen_reference text,
  ADD COLUMN IF NOT EXISTS supplier_type_id uuid REFERENCES supplier_type(supplier_type_id),
  ADD COLUMN IF NOT EXISTS withholding_rate numeric(9,4),
  ADD COLUMN IF NOT EXISTS withholding_certificate_ref text,
  ADD COLUMN IF NOT EXISTS withholding_certificate_expires_on date,
  ADD COLUMN IF NOT EXISTS avl_status text
      CHECK (avl_status IS NULL OR avl_status IN
        ('PROSPECT','PENDING_KYC','APPROVED','CONDITIONAL','SUSPENDED','BLOCKED','ARCHIVED')),
  ADD COLUMN IF NOT EXISTS approved_lanes text[],
  ADD COLUMN IF NOT EXISTS approved_service_categories text[],
  ADD COLUMN IF NOT EXISTS score_on_time numeric(5,2),
  ADD COLUMN IF NOT EXISTS score_claims numeric(5,2),
  ADD COLUMN IF NOT EXISTS score_disputes numeric(5,2),
  ADD COLUMN IF NOT EXISTS score_responsiveness numeric(5,2),
  ADD COLUMN IF NOT EXISTS score_safety numeric(5,2),
  ADD COLUMN IF NOT EXISTS score_compliance numeric(5,2),
  ADD COLUMN IF NOT EXISTS score_overall numeric(5,2),
  ADD COLUMN IF NOT EXISTS last_evaluated_at timestamptz;

-- Payment-method reconciliation (close gap): legacy used BANK_TRANSFER, the
-- current schema uses BANK. The CHECK already allows BANK; normalise any legacy
-- value on write here so no row is left on the retired token. No-op on a schema
-- that never held BANK_TRANSFER; idempotent.
UPDATE supplier_master SET payment_method = 'BANK' WHERE payment_method = 'BANK_TRANSFER';

-- ── 2.3 country_profile (jurisdiction reference) ───────────────────────────
CREATE TABLE IF NOT EXISTS country_profile (
  code                       char(2) PRIMARY KEY,   -- ISO 3166-1 alpha-2
  name                       text NOT NULL,
  phone_code                 text,                  -- E.164 calling code, bare digits
  currency                   char(3),               -- ISO 4217
  registration_requirements  jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order                 int NOT NULL DEFAULT 1000,
  created_at                 timestamptz NOT NULL DEFAULT now()
);

INSERT INTO country_profile (code, name, phone_code, currency, registration_requirements, sort_order) VALUES
  ('CM', 'Cameroon', '237', 'XAF', '[{"kind":"NIU","label_fr":"Numéro d''Identifiant Unique","label_en":"Unique Taxpayer Number","regex":"^[A-Za-z0-9]{8,20}$","placeholder":"P0123456789A","required":true},{"kind":"RCCM","label_fr":"Registre du Commerce et du Crédit Mobilier","label_en":"Trade & Personal Property Credit Register","regex":"^[A-Za-z0-9/\\-]{6,30}$","placeholder":"RC/DLA/2020/B/1234","required":true}]'::jsonb, 0),
  ('CF', 'Central African Republic', '236', 'XAF', '[{"kind":"NIU","label_fr":"Numéro d''Identifiant Unique","label_en":"Unique Taxpayer Number","regex":"^[A-Za-z0-9]{8,20}$","placeholder":"P0123456789A","required":true},{"kind":"RCCM","label_fr":"Registre du Commerce et du Crédit Mobilier","label_en":"Trade & Personal Property Credit Register","regex":"^[A-Za-z0-9/\\-]{6,30}$","placeholder":"RC/DLA/2020/B/1234","required":true}]'::jsonb, 1),
  ('TD', 'Chad', '235', 'XAF', '[{"kind":"NIU","label_fr":"Numéro d''Identifiant Unique","label_en":"Unique Taxpayer Number","regex":"^[A-Za-z0-9]{8,20}$","placeholder":"P0123456789A","required":true},{"kind":"RCCM","label_fr":"Registre du Commerce et du Crédit Mobilier","label_en":"Trade & Personal Property Credit Register","regex":"^[A-Za-z0-9/\\-]{6,30}$","placeholder":"RC/DLA/2020/B/1234","required":true}]'::jsonb, 2),
  ('CG', 'Congo (Republic)', '242', 'XAF', '[{"kind":"NIU","label_fr":"Numéro d''Identifiant Unique","label_en":"Unique Taxpayer Number","regex":"^[A-Za-z0-9]{8,20}$","placeholder":"P0123456789A","required":true},{"kind":"RCCM","label_fr":"Registre du Commerce et du Crédit Mobilier","label_en":"Trade & Personal Property Credit Register","regex":"^[A-Za-z0-9/\\-]{6,30}$","placeholder":"RC/DLA/2020/B/1234","required":true}]'::jsonb, 3),
  ('GA', 'Gabon', '241', 'XAF', '[{"kind":"NIU","label_fr":"Numéro d''Identifiant Unique","label_en":"Unique Taxpayer Number","regex":"^[A-Za-z0-9]{8,20}$","placeholder":"P0123456789A","required":true},{"kind":"RCCM","label_fr":"Registre du Commerce et du Crédit Mobilier","label_en":"Trade & Personal Property Credit Register","regex":"^[A-Za-z0-9/\\-]{6,30}$","placeholder":"RC/DLA/2020/B/1234","required":true}]'::jsonb, 4),
  ('GQ', 'Equatorial Guinea', '240', 'XAF', '[{"kind":"NIU","label_fr":"Numéro d''Identifiant Unique","label_en":"Unique Taxpayer Number","regex":"^[A-Za-z0-9]{8,20}$","placeholder":"P0123456789A","required":true},{"kind":"RCCM","label_fr":"Registre du Commerce et du Crédit Mobilier","label_en":"Trade & Personal Property Credit Register","regex":"^[A-Za-z0-9/\\-]{6,30}$","placeholder":"RC/DLA/2020/B/1234","required":true}]'::jsonb, 5),
  ('BJ', 'Benin', '229', 'XOF', '[{"kind":"NIU","label_fr":"Numéro d''Identifiant Unique","label_en":"Unique Taxpayer Number","regex":"^[A-Za-z0-9]{8,20}$","placeholder":"P0123456789A","required":true},{"kind":"RCCM","label_fr":"Registre du Commerce et du Crédit Mobilier","label_en":"Trade & Personal Property Credit Register","regex":"^[A-Za-z0-9/\\-]{6,30}$","placeholder":"RC/DLA/2020/B/1234","required":true}]'::jsonb, 6),
  ('BF', 'Burkina Faso', '226', 'XOF', '[{"kind":"NIU","label_fr":"Numéro d''Identifiant Unique","label_en":"Unique Taxpayer Number","regex":"^[A-Za-z0-9]{8,20}$","placeholder":"P0123456789A","required":true},{"kind":"RCCM","label_fr":"Registre du Commerce et du Crédit Mobilier","label_en":"Trade & Personal Property Credit Register","regex":"^[A-Za-z0-9/\\-]{6,30}$","placeholder":"RC/DLA/2020/B/1234","required":true}]'::jsonb, 7),
  ('CI', 'Côte d''Ivoire', '225', 'XOF', '[{"kind":"NIU","label_fr":"Numéro d''Identifiant Unique","label_en":"Unique Taxpayer Number","regex":"^[A-Za-z0-9]{8,20}$","placeholder":"P0123456789A","required":true},{"kind":"RCCM","label_fr":"Registre du Commerce et du Crédit Mobilier","label_en":"Trade & Personal Property Credit Register","regex":"^[A-Za-z0-9/\\-]{6,30}$","placeholder":"RC/DLA/2020/B/1234","required":true}]'::jsonb, 8),
  ('KM', 'Comoros', '269', 'KMF', '[{"kind":"NIU","label_fr":"Numéro d''Identifiant Unique","label_en":"Unique Taxpayer Number","regex":"^[A-Za-z0-9]{8,20}$","placeholder":"P0123456789A","required":true},{"kind":"RCCM","label_fr":"Registre du Commerce et du Crédit Mobilier","label_en":"Trade & Personal Property Credit Register","regex":"^[A-Za-z0-9/\\-]{6,30}$","placeholder":"RC/DLA/2020/B/1234","required":true}]'::jsonb, 9),
  ('CD', 'Congo (Democratic Republic)', '243', 'CDF', '[{"kind":"NIU","label_fr":"Numéro d''Identifiant Unique","label_en":"Unique Taxpayer Number","regex":"^[A-Za-z0-9]{8,20}$","placeholder":"P0123456789A","required":true},{"kind":"RCCM","label_fr":"Registre du Commerce et du Crédit Mobilier","label_en":"Trade & Personal Property Credit Register","regex":"^[A-Za-z0-9/\\-]{6,30}$","placeholder":"RC/DLA/2020/B/1234","required":true}]'::jsonb, 10),
  ('GW', 'Guinea-Bissau', '245', 'XOF', '[{"kind":"NIU","label_fr":"Numéro d''Identifiant Unique","label_en":"Unique Taxpayer Number","regex":"^[A-Za-z0-9]{8,20}$","placeholder":"P0123456789A","required":true},{"kind":"RCCM","label_fr":"Registre du Commerce et du Crédit Mobilier","label_en":"Trade & Personal Property Credit Register","regex":"^[A-Za-z0-9/\\-]{6,30}$","placeholder":"RC/DLA/2020/B/1234","required":true}]'::jsonb, 11),
  ('GN', 'Guinea', '224', 'GNF', '[{"kind":"NIU","label_fr":"Numéro d''Identifiant Unique","label_en":"Unique Taxpayer Number","regex":"^[A-Za-z0-9]{8,20}$","placeholder":"P0123456789A","required":true},{"kind":"RCCM","label_fr":"Registre du Commerce et du Crédit Mobilier","label_en":"Trade & Personal Property Credit Register","regex":"^[A-Za-z0-9/\\-]{6,30}$","placeholder":"RC/DLA/2020/B/1234","required":true}]'::jsonb, 12),
  ('ML', 'Mali', '223', 'XOF', '[{"kind":"NIU","label_fr":"Numéro d''Identifiant Unique","label_en":"Unique Taxpayer Number","regex":"^[A-Za-z0-9]{8,20}$","placeholder":"P0123456789A","required":true},{"kind":"RCCM","label_fr":"Registre du Commerce et du Crédit Mobilier","label_en":"Trade & Personal Property Credit Register","regex":"^[A-Za-z0-9/\\-]{6,30}$","placeholder":"RC/DLA/2020/B/1234","required":true}]'::jsonb, 13),
  ('NE', 'Niger', '227', 'XOF', '[{"kind":"NIU","label_fr":"Numéro d''Identifiant Unique","label_en":"Unique Taxpayer Number","regex":"^[A-Za-z0-9]{8,20}$","placeholder":"P0123456789A","required":true},{"kind":"RCCM","label_fr":"Registre du Commerce et du Crédit Mobilier","label_en":"Trade & Personal Property Credit Register","regex":"^[A-Za-z0-9/\\-]{6,30}$","placeholder":"RC/DLA/2020/B/1234","required":true}]'::jsonb, 14),
  ('SN', 'Senegal', '221', 'XOF', '[{"kind":"NIU","label_fr":"Numéro d''Identifiant Unique","label_en":"Unique Taxpayer Number","regex":"^[A-Za-z0-9]{8,20}$","placeholder":"P0123456789A","required":true},{"kind":"RCCM","label_fr":"Registre du Commerce et du Crédit Mobilier","label_en":"Trade & Personal Property Credit Register","regex":"^[A-Za-z0-9/\\-]{6,30}$","placeholder":"RC/DLA/2020/B/1234","required":true}]'::jsonb, 15),
  ('TG', 'Togo', '228', 'XOF', '[{"kind":"NIU","label_fr":"Numéro d''Identifiant Unique","label_en":"Unique Taxpayer Number","regex":"^[A-Za-z0-9]{8,20}$","placeholder":"P0123456789A","required":true},{"kind":"RCCM","label_fr":"Registre du Commerce et du Crédit Mobilier","label_en":"Trade & Personal Property Credit Register","regex":"^[A-Za-z0-9/\\-]{6,30}$","placeholder":"RC/DLA/2020/B/1234","required":true}]'::jsonb, 16),
  ('CN', 'China', '86', 'CNY', '[]'::jsonb, 17),
  ('US', 'United States', '1', 'USD', '[{"kind":"EIN","label_fr":"Employer Identification Number","label_en":"Employer Identification Number (EIN)","regex":"^\\d{2}-?\\d{7}$","placeholder":"12-3456789","required":true},{"kind":"W9","label_fr":"Formulaire W-9","label_en":"Form W-9","regex":"","placeholder":"On file","required":false}]'::jsonb, 18),
  ('FR', 'France', '33', 'EUR', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 19),
  ('NL', 'Netherlands', '31', 'EUR', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 20),
  ('BE', 'Belgium', '32', 'EUR', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 21),
  ('DE', 'Germany', '49', 'EUR', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 22),
  ('GB', 'United Kingdom', '44', 'GBP', '[{"kind":"CRN","label_fr":"Companies House Number","label_en":"Companies House Number","regex":"^[A-Za-z0-9]{8}$","placeholder":"01234567","required":true},{"kind":"VAT","label_fr":"Numéro de TVA","label_en":"VAT number","regex":"^GB[0-9]{9,12}$","placeholder":"GB123456789","required":false},{"kind":"UTR","label_fr":"Unique Taxpayer Reference","label_en":"Unique Taxpayer Reference (UTR)","regex":"^\\d{10}$","placeholder":"1234567890","required":false}]'::jsonb, 23),
  ('AE', 'United Arab Emirates', '971', 'AED', '[]'::jsonb, 24),
  ('IN', 'India', '91', 'INR', '[]'::jsonb, 25),
  ('ZA', 'South Africa', '27', 'ZAR', '[]'::jsonb, 26),
  ('NG', 'Nigeria', '234', 'NGN', '[]'::jsonb, 27),
  ('GH', 'Ghana', '233', 'GHS', '[]'::jsonb, 28),
  ('TR', 'Türkiye', '90', 'TRY', '[]'::jsonb, 29),
  ('IT', 'Italy', '39', 'EUR', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 30),
  ('ES', 'Spain', '34', 'EUR', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 31),
  ('SG', 'Singapore', '65', 'SGD', '[]'::jsonb, 32),
  ('HK', 'Hong Kong', '852', 'HKD', '[]'::jsonb, 33),
  ('JP', 'Japan', '81', 'JPY', '[]'::jsonb, 34),
  ('KR', 'South Korea', '82', 'KRW', '[]'::jsonb, 35),
  ('BR', 'Brazil', '55', 'BRL', '[]'::jsonb, 36),
  ('MA', 'Morocco', '212', 'MAD', '[]'::jsonb, 37),
  ('EG', 'Egypt', '20', 'EGP', '[]'::jsonb, 38),
  ('AF', 'Afghanistan', '93', 'AFN', '[]'::jsonb, 1000),
  ('AX', 'Åland Islands', '358', 'EUR', '[]'::jsonb, 1001),
  ('AL', 'Albania', '355', 'ALL', '[]'::jsonb, 1002),
  ('DZ', 'Algeria', '213', 'DZD', '[]'::jsonb, 1003),
  ('AS', 'American Samoa', '1684', 'USD', '[]'::jsonb, 1004),
  ('AD', 'Andorra', '376', 'EUR', '[]'::jsonb, 1005),
  ('AO', 'Angola', '244', 'AOA', '[]'::jsonb, 1006),
  ('AI', 'Anguilla', '1264', 'XCD', '[]'::jsonb, 1007),
  ('AQ', 'Antarctica', '672', 'USD', '[]'::jsonb, 1008),
  ('AG', 'Antigua and Barbuda', '1268', 'XCD', '[]'::jsonb, 1009),
  ('AR', 'Argentina', '54', 'ARS', '[]'::jsonb, 1010),
  ('AM', 'Armenia', '374', 'AMD', '[]'::jsonb, 1011),
  ('AW', 'Aruba', '297', 'AWG', '[]'::jsonb, 1012),
  ('AU', 'Australia', '61', 'AUD', '[]'::jsonb, 1013),
  ('AT', 'Austria', '43', 'EUR', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 1014),
  ('AZ', 'Azerbaijan', '994', 'AZN', '[]'::jsonb, 1015),
  ('BS', 'Bahamas', '1242', 'BSD', '[]'::jsonb, 1016),
  ('BH', 'Bahrain', '973', 'BHD', '[]'::jsonb, 1017),
  ('BD', 'Bangladesh', '880', 'BDT', '[]'::jsonb, 1018),
  ('BB', 'Barbados', '1246', 'BBD', '[]'::jsonb, 1019),
  ('BY', 'Belarus', '375', 'BYN', '[]'::jsonb, 1020),
  ('BZ', 'Belize', '501', 'BZD', '[]'::jsonb, 1022),
  ('BM', 'Bermuda', '1441', 'BMD', '[]'::jsonb, 1024),
  ('BT', 'Bhutan', '975', 'BTN', '[]'::jsonb, 1025),
  ('BO', 'Bolivia', '591', 'BOB', '[]'::jsonb, 1026),
  ('BQ', 'Bonaire, Sint Eustatius and Saba', '599', 'USD', '[]'::jsonb, 1027),
  ('BA', 'Bosnia and Herzegovina', '387', 'BAM', '[]'::jsonb, 1028),
  ('BW', 'Botswana', '267', 'BWP', '[]'::jsonb, 1029),
  ('BV', 'Bouvet Island', '47', 'NOK', '[]'::jsonb, 1030),
  ('IO', 'British Indian Ocean Territory', '246', 'USD', '[]'::jsonb, 1032),
  ('BN', 'Brunei Darussalam', '673', 'BND', '[]'::jsonb, 1033),
  ('BG', 'Bulgaria', '359', 'BGN', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 1034),
  ('BI', 'Burundi', '257', 'BIF', '[]'::jsonb, 1036),
  ('CV', 'Cabo Verde', '238', 'CVE', '[]'::jsonb, 1037),
  ('KH', 'Cambodia', '855', 'KHR', '[]'::jsonb, 1038),
  ('CA', 'Canada', '1', 'CAD', '[]'::jsonb, 1040),
  ('KY', 'Cayman Islands', '1345', 'KYD', '[]'::jsonb, 1041),
  ('CL', 'Chile', '56', 'CLP', '[]'::jsonb, 1044),
  ('CX', 'Christmas Island', '61', 'AUD', '[]'::jsonb, 1046),
  ('CC', 'Cocos (Keeling) Islands', '61', 'AUD', '[]'::jsonb, 1047),
  ('CO', 'Colombia', '57', 'COP', '[]'::jsonb, 1048),
  ('CK', 'Cook Islands', '682', 'NZD', '[]'::jsonb, 1052),
  ('CR', 'Costa Rica', '506', 'CRC', '[]'::jsonb, 1053),
  ('HR', 'Croatia', '385', 'EUR', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 1055),
  ('CU', 'Cuba', '53', 'CUP', '[]'::jsonb, 1056),
  ('CW', 'Curaçao', '599', 'ANG', '[]'::jsonb, 1057),
  ('CY', 'Cyprus', '357', 'EUR', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 1058),
  ('CZ', 'Czechia', '420', 'CZK', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 1059),
  ('DK', 'Denmark', '45', 'DKK', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 1060),
  ('DJ', 'Djibouti', '253', 'DJF', '[]'::jsonb, 1061),
  ('DM', 'Dominica', '1767', 'XCD', '[]'::jsonb, 1062),
  ('DO', 'Dominican Republic', '1809', 'DOP', '[]'::jsonb, 1063),
  ('EC', 'Ecuador', '593', 'USD', '[]'::jsonb, 1064),
  ('SV', 'El Salvador', '503', 'USD', '[]'::jsonb, 1066),
  ('ER', 'Eritrea', '291', 'ERN', '[]'::jsonb, 1068),
  ('EE', 'Estonia', '372', 'EUR', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 1069),
  ('SZ', 'Eswatini', '268', 'SZL', '[]'::jsonb, 1070),
  ('ET', 'Ethiopia', '251', 'ETB', '[]'::jsonb, 1071),
  ('FK', 'Falkland Islands', '500', 'FKP', '[]'::jsonb, 1072),
  ('FO', 'Faroe Islands', '298', 'DKK', '[]'::jsonb, 1073),
  ('FJ', 'Fiji', '679', 'FJD', '[]'::jsonb, 1074),
  ('FI', 'Finland', '358', 'EUR', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 1075),
  ('GF', 'French Guiana', '594', 'EUR', '[]'::jsonb, 1077),
  ('PF', 'French Polynesia', '689', 'XPF', '[]'::jsonb, 1078),
  ('TF', 'French Southern Territories', '262', 'EUR', '[]'::jsonb, 1079),
  ('GM', 'Gambia', '220', 'GMD', '[]'::jsonb, 1081),
  ('GE', 'Georgia', '995', 'GEL', '[]'::jsonb, 1082),
  ('GI', 'Gibraltar', '350', 'GIP', '[]'::jsonb, 1085),
  ('GR', 'Greece', '30', 'EUR', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 1086),
  ('GL', 'Greenland', '299', 'DKK', '[]'::jsonb, 1087),
  ('GD', 'Grenada', '1473', 'XCD', '[]'::jsonb, 1088),
  ('GP', 'Guadeloupe', '590', 'EUR', '[]'::jsonb, 1089),
  ('GU', 'Guam', '1671', 'USD', '[]'::jsonb, 1090),
  ('GT', 'Guatemala', '502', 'GTQ', '[]'::jsonb, 1091),
  ('GG', 'Guernsey', '44', 'GBP', '[]'::jsonb, 1092),
  ('GY', 'Guyana', '592', 'GYD', '[]'::jsonb, 1095),
  ('HT', 'Haiti', '509', 'HTG', '[]'::jsonb, 1096),
  ('HM', 'Heard Island and McDonald Islands', '672', 'AUD', '[]'::jsonb, 1097),
  ('VA', 'Holy See', '379', 'EUR', '[]'::jsonb, 1098),
  ('HN', 'Honduras', '504', 'HNL', '[]'::jsonb, 1099),
  ('HU', 'Hungary', '36', 'HUF', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 1101),
  ('IS', 'Iceland', '354', 'ISK', '[]'::jsonb, 1102),
  ('ID', 'Indonesia', '62', 'IDR', '[]'::jsonb, 1104),
  ('IR', 'Iran', '98', 'IRR', '[]'::jsonb, 1105),
  ('IQ', 'Iraq', '964', 'IQD', '[]'::jsonb, 1106),
  ('IE', 'Ireland', '353', 'EUR', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 1107),
  ('IM', 'Isle of Man', '44', 'GBP', '[]'::jsonb, 1108),
  ('IL', 'Israel', '972', 'ILS', '[]'::jsonb, 1109),
  ('JM', 'Jamaica', '1876', 'JMD', '[]'::jsonb, 1111),
  ('JE', 'Jersey', '44', 'GBP', '[]'::jsonb, 1113),
  ('JO', 'Jordan', '962', 'JOD', '[]'::jsonb, 1114),
  ('KZ', 'Kazakhstan', '7', 'KZT', '[]'::jsonb, 1115),
  ('KE', 'Kenya', '254', 'KES', '[]'::jsonb, 1116),
  ('KI', 'Kiribati', '686', 'AUD', '[]'::jsonb, 1117),
  ('KW', 'Kuwait', '965', 'KWD', '[]'::jsonb, 1118),
  ('KG', 'Kyrgyzstan', '996', 'KGS', '[]'::jsonb, 1119),
  ('LA', 'Laos', '856', 'LAK', '[]'::jsonb, 1120),
  ('LV', 'Latvia', '371', 'EUR', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 1121),
  ('LB', 'Lebanon', '961', 'LBP', '[]'::jsonb, 1122),
  ('LS', 'Lesotho', '266', 'LSL', '[]'::jsonb, 1123),
  ('LR', 'Liberia', '231', 'LRD', '[]'::jsonb, 1124),
  ('LY', 'Libya', '218', 'LYD', '[]'::jsonb, 1125),
  ('LI', 'Liechtenstein', '423', 'CHF', '[]'::jsonb, 1126),
  ('LT', 'Lithuania', '370', 'EUR', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 1127),
  ('LU', 'Luxembourg', '352', 'EUR', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 1128),
  ('MO', 'Macao', '853', 'MOP', '[]'::jsonb, 1129),
  ('MG', 'Madagascar', '261', 'MGA', '[]'::jsonb, 1130),
  ('MW', 'Malawi', '265', 'MWK', '[]'::jsonb, 1131),
  ('MY', 'Malaysia', '60', 'MYR', '[]'::jsonb, 1132),
  ('MV', 'Maldives', '960', 'MVR', '[]'::jsonb, 1133),
  ('MT', 'Malta', '356', 'EUR', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 1135),
  ('MH', 'Marshall Islands', '692', 'USD', '[]'::jsonb, 1136),
  ('MQ', 'Martinique', '596', 'EUR', '[]'::jsonb, 1137),
  ('MR', 'Mauritania', '222', 'MRU', '[]'::jsonb, 1138),
  ('MU', 'Mauritius', '230', 'MUR', '[]'::jsonb, 1139),
  ('YT', 'Mayotte', '262', 'EUR', '[]'::jsonb, 1140),
  ('MX', 'Mexico', '52', 'MXN', '[]'::jsonb, 1141),
  ('FM', 'Micronesia', '691', 'USD', '[]'::jsonb, 1142),
  ('MD', 'Moldova', '373', 'MDL', '[]'::jsonb, 1143),
  ('MC', 'Monaco', '377', 'EUR', '[]'::jsonb, 1144),
  ('MN', 'Mongolia', '976', 'MNT', '[]'::jsonb, 1145),
  ('ME', 'Montenegro', '382', 'EUR', '[]'::jsonb, 1146),
  ('MS', 'Montserrat', '1664', 'XCD', '[]'::jsonb, 1147),
  ('MZ', 'Mozambique', '258', 'MZN', '[]'::jsonb, 1149),
  ('MM', 'Myanmar', '95', 'MMK', '[]'::jsonb, 1150),
  ('NA', 'Namibia', '264', 'NAD', '[]'::jsonb, 1151),
  ('NR', 'Nauru', '674', 'AUD', '[]'::jsonb, 1152),
  ('NP', 'Nepal', '977', 'NPR', '[]'::jsonb, 1153),
  ('NC', 'New Caledonia', '687', 'XPF', '[]'::jsonb, 1155),
  ('NZ', 'New Zealand', '64', 'NZD', '[]'::jsonb, 1156),
  ('NI', 'Nicaragua', '505', 'NIO', '[]'::jsonb, 1157),
  ('NU', 'Niue', '683', 'NZD', '[]'::jsonb, 1160),
  ('NF', 'Norfolk Island', '672', 'AUD', '[]'::jsonb, 1161),
  ('KP', 'North Korea', '850', 'KPW', '[]'::jsonb, 1162),
  ('MK', 'North Macedonia', '389', 'MKD', '[]'::jsonb, 1163),
  ('MP', 'Northern Mariana Islands', '1670', 'USD', '[]'::jsonb, 1164),
  ('NO', 'Norway', '47', 'NOK', '[]'::jsonb, 1165),
  ('OM', 'Oman', '968', 'OMR', '[]'::jsonb, 1166),
  ('PK', 'Pakistan', '92', 'PKR', '[]'::jsonb, 1167),
  ('PW', 'Palau', '680', 'USD', '[]'::jsonb, 1168),
  ('PS', 'Palestine', '970', 'ILS', '[]'::jsonb, 1169),
  ('PA', 'Panama', '507', 'PAB', '[]'::jsonb, 1170),
  ('PG', 'Papua New Guinea', '675', 'PGK', '[]'::jsonb, 1171),
  ('PY', 'Paraguay', '595', 'PYG', '[]'::jsonb, 1172),
  ('PE', 'Peru', '51', 'PEN', '[]'::jsonb, 1173),
  ('PH', 'Philippines', '63', 'PHP', '[]'::jsonb, 1174),
  ('PN', 'Pitcairn', '64', 'NZD', '[]'::jsonb, 1175),
  ('PL', 'Poland', '48', 'PLN', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 1176),
  ('PT', 'Portugal', '351', 'EUR', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 1177),
  ('PR', 'Puerto Rico', '1787', 'USD', '[]'::jsonb, 1178),
  ('QA', 'Qatar', '974', 'QAR', '[]'::jsonb, 1179),
  ('RE', 'Réunion', '262', 'EUR', '[]'::jsonb, 1180),
  ('RO', 'Romania', '40', 'RON', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 1181),
  ('RU', 'Russia', '7', 'RUB', '[]'::jsonb, 1182),
  ('RW', 'Rwanda', '250', 'RWF', '[]'::jsonb, 1183),
  ('BL', 'Saint Barthélemy', '590', 'EUR', '[]'::jsonb, 1184),
  ('SH', 'Saint Helena', '290', 'SHP', '[]'::jsonb, 1185),
  ('KN', 'Saint Kitts and Nevis', '1869', 'XCD', '[]'::jsonb, 1186),
  ('LC', 'Saint Lucia', '1758', 'XCD', '[]'::jsonb, 1187),
  ('MF', 'Saint Martin (French part)', '590', 'EUR', '[]'::jsonb, 1188),
  ('PM', 'Saint Pierre and Miquelon', '508', 'EUR', '[]'::jsonb, 1189),
  ('VC', 'Saint Vincent and the Grenadines', '1784', 'XCD', '[]'::jsonb, 1190),
  ('WS', 'Samoa', '685', 'WST', '[]'::jsonb, 1191),
  ('SM', 'San Marino', '378', 'EUR', '[]'::jsonb, 1192),
  ('ST', 'Sao Tome and Principe', '239', 'STN', '[]'::jsonb, 1193),
  ('SA', 'Saudi Arabia', '966', 'SAR', '[]'::jsonb, 1194),
  ('RS', 'Serbia', '381', 'RSD', '[]'::jsonb, 1196),
  ('SC', 'Seychelles', '248', 'SCR', '[]'::jsonb, 1197),
  ('SL', 'Sierra Leone', '232', 'SLE', '[]'::jsonb, 1198),
  ('SX', 'Sint Maarten (Dutch part)', '1721', 'ANG', '[]'::jsonb, 1200),
  ('SK', 'Slovakia', '421', 'EUR', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 1201),
  ('SI', 'Slovenia', '386', 'EUR', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 1202),
  ('SB', 'Solomon Islands', '677', 'SBD', '[]'::jsonb, 1203),
  ('SO', 'Somalia', '252', 'SOS', '[]'::jsonb, 1204),
  ('GS', 'South Georgia and the South Sandwich Islands', '500', 'GBP', '[]'::jsonb, 1206),
  ('SS', 'South Sudan', '211', 'SSP', '[]'::jsonb, 1208),
  ('LK', 'Sri Lanka', '94', 'LKR', '[]'::jsonb, 1210),
  ('SD', 'Sudan', '249', 'SDG', '[]'::jsonb, 1211),
  ('SR', 'Suriname', '597', 'SRD', '[]'::jsonb, 1212),
  ('SJ', 'Svalbard and Jan Mayen', '47', 'NOK', '[]'::jsonb, 1213),
  ('SE', 'Sweden', '46', 'SEK', '[{"kind":"VAT","label_fr":"Numéro de TVA intracommunautaire","label_en":"VAT number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{2,12}$","placeholder":"FR12345678901","required":true},{"kind":"EORI","label_fr":"Numéro EORI","label_en":"EORI number","regex":"^[A-Za-z]{2}[A-Za-z0-9]{1,15}$","placeholder":"FR123456789012345","required":false}]'::jsonb, 1214),
  ('CH', 'Switzerland', '41', 'CHF', '[]'::jsonb, 1215),
  ('SY', 'Syria', '963', 'SYP', '[]'::jsonb, 1216),
  ('TW', 'Taiwan', '886', 'TWD', '[]'::jsonb, 1217),
  ('TJ', 'Tajikistan', '992', 'TJS', '[]'::jsonb, 1218),
  ('TZ', 'Tanzania', '255', 'TZS', '[]'::jsonb, 1219),
  ('TH', 'Thailand', '66', 'THB', '[]'::jsonb, 1220),
  ('TL', 'Timor-Leste', '670', 'USD', '[]'::jsonb, 1221),
  ('TK', 'Tokelau', '690', 'NZD', '[]'::jsonb, 1223),
  ('TO', 'Tonga', '676', 'TOP', '[]'::jsonb, 1224),
  ('TT', 'Trinidad and Tobago', '1868', 'TTD', '[]'::jsonb, 1225),
  ('TN', 'Tunisia', '216', 'TND', '[]'::jsonb, 1226),
  ('TM', 'Turkmenistan', '993', 'TMT', '[]'::jsonb, 1228),
  ('TC', 'Turks and Caicos Islands', '1649', 'USD', '[]'::jsonb, 1229),
  ('TV', 'Tuvalu', '688', 'AUD', '[]'::jsonb, 1230),
  ('UG', 'Uganda', '256', 'UGX', '[]'::jsonb, 1231),
  ('UA', 'Ukraine', '380', 'UAH', '[]'::jsonb, 1232),
  ('UM', 'United States Minor Outlying Islands', '1', 'USD', '[]'::jsonb, 1236),
  ('UY', 'Uruguay', '598', 'UYU', '[]'::jsonb, 1237),
  ('UZ', 'Uzbekistan', '998', 'UZS', '[]'::jsonb, 1238),
  ('VU', 'Vanuatu', '678', 'VUV', '[]'::jsonb, 1239),
  ('VE', 'Venezuela', '58', 'VES', '[]'::jsonb, 1240),
  ('VN', 'Vietnam', '84', 'VND', '[]'::jsonb, 1241),
  ('VG', 'Virgin Islands (British)', '1284', 'USD', '[]'::jsonb, 1242),
  ('VI', 'Virgin Islands (U.S.)', '1340', 'USD', '[]'::jsonb, 1243),
  ('WF', 'Wallis and Futuna', '681', 'XPF', '[]'::jsonb, 1244),
  ('EH', 'Western Sahara', '212', 'MAD', '[]'::jsonb, 1245),
  ('YE', 'Yemen', '967', 'YER', '[]'::jsonb, 1246),
  ('ZM', 'Zambia', '260', 'ZMW', '[]'::jsonb, 1247),
  ('ZW', 'Zimbabwe', '263', 'USD', '[]'::jsonb, 1248)
ON CONFLICT (code) DO NOTHING;

-- ── 2.4 party_registration (global tax/legal IDs) ──────────────────────────
CREATE TABLE IF NOT EXISTS party_registration (
  registration_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid REFERENCES client_master(client_id) ON DELETE CASCADE,
  supplier_id       uuid REFERENCES supplier_master(supplier_id) ON DELETE CASCADE,
  country_code      char(2),
  kind              text NOT NULL,     -- NIU, RCCM, EORI, VAT, EIN, W9, LEI, DUNS, IATA, FMC, AEO, …
  number            text,
  issuing_authority text,
  issued_on         date,
  expires_on        date,
  verified          boolean NOT NULL DEFAULT false,
  verified_by       uuid REFERENCES app_user(user_id),
  verified_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Exactly one of client_id / supplier_id is set (the masters stay separate).
  CONSTRAINT party_registration_one_party CHECK ((client_id IS NOT NULL) <> (supplier_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_party_reg_client   ON party_registration(client_id);
CREATE INDEX IF NOT EXISTS ix_party_reg_supplier ON party_registration(supplier_id);

-- ── 2.6 party_document_type registry ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS party_document_type (
  document_type_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                       citext UNIQUE NOT NULL,
  name                       text NOT NULL,
  applies_to                 text NOT NULL DEFAULT 'BOTH' CHECK (applies_to IN ('CLIENT','SUPPLIER','BOTH')),
  is_system                  boolean NOT NULL DEFAULT false,
  is_active                  boolean NOT NULL DEFAULT true,
  requires_expiry            boolean NOT NULL DEFAULT true,
  requires_issuing_authority boolean NOT NULL DEFAULT false,
  default_severity           text NOT NULL DEFAULT 'ESCALATED'
      CHECK (default_severity IN ('INFO','WARN','ESCALATED','SOFT_BLOCK_RECOMMENDATION')),
  created_at                 timestamptz NOT NULL DEFAULT now()
);

-- ── 2.7 counterparty documents (client_document / supplier_document) ────────
-- A KYC/compliance document row. Digital scan (vault_id) is a VERIFICATION gate,
-- not a creation gate (Hard Rule 9): a row may be saved paper-only with a
-- physical_ref and scan_status='PENDING'; the party cannot reach VERIFIED /
-- supplier AVL-APPROVED until a scan exists in document_vault and is verified.
CREATE TABLE IF NOT EXISTS client_document (
  document_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES client_master(client_id) ON DELETE CASCADE,
  document_type_id    uuid REFERENCES party_document_type(document_type_id),
  document_number     text,
  issuing_authority   text,
  issued_on           date,
  expires_on          date,
  vault_id            uuid REFERENCES document_vault(doc_id),   -- digital scan; required for verification, not creation
  scan_status         text NOT NULL DEFAULT 'PENDING'
      CHECK (scan_status IN ('PENDING','SCANNED','VERIFIED','REJECTED','EXPIRED')),
  physical_ref        text,                                      -- archive/box reference for a paper original
  scan_due_on         date,                                      -- SLA deadline; a missing scan ESCALATES after it
  verification_status text NOT NULL DEFAULT 'PENDING'
      CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED','EXPIRED')),
  verified_by         uuid REFERENCES app_user(user_id),
  verified_at         timestamptz,
  rejection_reason    text,
  content_hash        text,
  version_no          int NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES app_user(user_id),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_client_doc_type    ON client_document(client_id, document_type_id);
CREATE INDEX IF NOT EXISTS ix_client_doc_expires ON client_document(expires_on);
CREATE INDEX IF NOT EXISTS ix_client_doc_scan    ON client_document(scan_status);

CREATE TABLE IF NOT EXISTS supplier_document (
  document_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id         uuid NOT NULL REFERENCES supplier_master(supplier_id) ON DELETE CASCADE,
  document_type_id    uuid REFERENCES party_document_type(document_type_id),
  document_number     text,
  issuing_authority   text,
  issued_on           date,
  expires_on          date,
  vault_id            uuid REFERENCES document_vault(doc_id),
  scan_status         text NOT NULL DEFAULT 'PENDING'
      CHECK (scan_status IN ('PENDING','SCANNED','VERIFIED','REJECTED','EXPIRED')),
  physical_ref        text,
  scan_due_on         date,
  verification_status text NOT NULL DEFAULT 'PENDING'
      CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED','EXPIRED')),
  verified_by         uuid REFERENCES app_user(user_id),
  verified_at         timestamptz,
  rejection_reason    text,
  content_hash        text,
  version_no          int NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES app_user(user_id),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_supplier_doc_type    ON supplier_document(supplier_id, document_type_id);
CREATE INDEX IF NOT EXISTS ix_supplier_doc_expires ON supplier_document(expires_on);
CREATE INDEX IF NOT EXISTS ix_supplier_doc_scan    ON supplier_document(scan_status);

-- ── 2.8 contacts (multiple, role-tagged) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS client_contact (
  contact_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES client_master(client_id) ON DELETE CASCADE,
  name          text NOT NULL,
  title         text,
  email         citext,
  phone         text,                       -- E.164, normalised with the picker's country code
  role_tags     text[] NOT NULL DEFAULT '{}',
  is_primary    boolean NOT NULL DEFAULT false,
  language      char(2),
  timezone      text,
  portal_access boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_client_contact_party ON client_contact(client_id);

CREATE TABLE IF NOT EXISTS supplier_contact (
  contact_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id   uuid NOT NULL REFERENCES supplier_master(supplier_id) ON DELETE CASCADE,
  name          text NOT NULL,
  title         text,
  email         citext,
  phone         text,
  role_tags     text[] NOT NULL DEFAULT '{}',
  is_primary    boolean NOT NULL DEFAULT false,
  language      char(2),
  timezone      text,
  portal_access boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_supplier_contact_party ON supplier_contact(supplier_id);

-- ── 2.9 addresses (multiple, typed) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_address (
  address_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES client_master(client_id) ON DELETE CASCADE,
  line1        text,
  line2        text,
  city         text,
  region       text,
  postal_code  text,
  country_code char(2),
  type         text CHECK (type IS NULL OR type IN
                 ('REGISTERED','BILLING','DELIVERY','PICKUP','WAREHOUSE','REMITTANCE','NOTIFY')),
  is_primary   boolean NOT NULL DEFAULT false,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_client_address_party ON client_address(client_id);

CREATE TABLE IF NOT EXISTS supplier_address (
  address_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id  uuid NOT NULL REFERENCES supplier_master(supplier_id) ON DELETE CASCADE,
  line1        text,
  line2        text,
  city         text,
  region       text,
  postal_code  text,
  country_code char(2),
  type         text CHECK (type IS NULL OR type IN
                 ('REGISTERED','BILLING','DELIVERY','PICKUP','WAREHOUSE','REMITTANCE','NOTIFY')),
  is_primary   boolean NOT NULL DEFAULT false,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_supplier_address_party ON supplier_address(supplier_id);

-- ── 2.10 bank / payment accounts (multiple, high-risk) ─────────────────────
-- Every insert/update writes an immutable-ledger entry and emits a high-priority
-- event (BEC fraud control); in Live, changes go through maker-checker. Enforced
-- in the service layer (src/modules/master/*/…bank.*), not the schema.
CREATE TABLE IF NOT EXISTS client_bank_account (
  bank_account_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES client_master(client_id) ON DELETE CASCADE,
  beneficiary_name text,
  bank_name        text,
  branch           text,
  account_number   text,
  iban             text,
  swift_bic        text,
  routing_code     text,
  currency         char(3),
  momo_network     text,
  momo_number      text,
  is_primary       boolean NOT NULL DEFAULT false,
  is_verified      boolean NOT NULL DEFAULT false,
  verified_by      uuid REFERENCES app_user(user_id),
  verified_at      timestamptz,
  is_active        boolean NOT NULL DEFAULT true,
  created_by       uuid REFERENCES app_user(user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_client_bank_party ON client_bank_account(client_id);

CREATE TABLE IF NOT EXISTS supplier_bank_account (
  bank_account_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id      uuid NOT NULL REFERENCES supplier_master(supplier_id) ON DELETE CASCADE,
  beneficiary_name text,
  bank_name        text,
  branch           text,
  account_number   text,
  iban             text,
  swift_bic        text,
  routing_code     text,
  currency         char(3),
  momo_network     text,
  momo_number      text,
  is_primary       boolean NOT NULL DEFAULT false,
  is_verified      boolean NOT NULL DEFAULT false,
  verified_by      uuid REFERENCES app_user(user_id),
  verified_at      timestamptz,
  is_active        boolean NOT NULL DEFAULT true,
  created_by       uuid REFERENCES app_user(user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_supplier_bank_party ON supplier_bank_account(supplier_id);

-- ── 2.11 beneficial owners (AML) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_beneficial_owner (
  owner_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES client_master(client_id) ON DELETE CASCADE,
  full_name         text NOT NULL,
  date_of_birth     date,
  nationality       char(2),
  id_type           text,
  id_number         text,
  ownership_percent numeric(5,2),
  is_pep            boolean NOT NULL DEFAULT false,
  notes             text,
  vault_id          uuid REFERENCES document_vault(doc_id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_client_bo_party ON client_beneficial_owner(client_id);

CREATE TABLE IF NOT EXISTS supplier_beneficial_owner (
  owner_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id       uuid NOT NULL REFERENCES supplier_master(supplier_id) ON DELETE CASCADE,
  full_name         text NOT NULL,
  date_of_birth     date,
  nationality       char(2),
  id_type           text,
  id_number         text,
  ownership_percent numeric(5,2),
  is_pep            boolean NOT NULL DEFAULT false,
  notes             text,
  vault_id          uuid REFERENCES document_vault(doc_id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_supplier_bo_party ON supplier_beneficial_owner(supplier_id);

-- ── 5.1 party_field_config (per-tenant required/visible field policy) ───────
-- `field_group` is the group in the spec (IDENTITY/CONTACT/ADDRESS/BANK/
-- COMPLIANCE/ACCOUNTING). Named field_group rather than `group` because the
-- latter is a reserved word that every repo and raw SELECT would have to quote.
CREATE TABLE IF NOT EXISTS party_field_config (
  config_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applies_to     text NOT NULL CHECK (applies_to IN ('CLIENT','SUPPLIER')),
  field_key      text NOT NULL,
  field_group    text,
  is_required    boolean NOT NULL DEFAULT false,
  is_visible     boolean NOT NULL DEFAULT true,
  is_custom      boolean NOT NULL DEFAULT false,
  sort_order     int NOT NULL DEFAULT 100,
  label_override text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (applies_to, field_key)
);

-- ── updated_at triggers on the child tables that carry one ─────────────────
DROP TRIGGER IF EXISTS trg_client_document_updated   ON client_document;
CREATE TRIGGER trg_client_document_updated   BEFORE UPDATE ON client_document   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_supplier_document_updated ON supplier_document;
CREATE TRIGGER trg_supplier_document_updated BEFORE UPDATE ON supplier_document FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_client_contact_updated    ON client_contact;
CREATE TRIGGER trg_client_contact_updated    BEFORE UPDATE ON client_contact    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_supplier_contact_updated  ON supplier_contact;
CREATE TRIGGER trg_supplier_contact_updated  BEFORE UPDATE ON supplier_contact  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_client_address_updated    ON client_address;
CREATE TRIGGER trg_client_address_updated    BEFORE UPDATE ON client_address    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_supplier_address_updated  ON supplier_address;
CREATE TRIGGER trg_supplier_address_updated  BEFORE UPDATE ON supplier_address  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_client_bank_updated       ON client_bank_account;
CREATE TRIGGER trg_client_bank_updated       BEFORE UPDATE ON client_bank_account   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_supplier_bank_updated     ON supplier_bank_account;
CREATE TRIGGER trg_supplier_bank_updated     BEFORE UPDATE ON supplier_bank_account FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_party_field_config_updated ON party_field_config;
CREATE TRIGGER trg_party_field_config_updated BEFORE UPDATE ON party_field_config FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2.5 client_type symmetry — bring the pre-existing table (0300) in line ──
-- 0300's client_type had only {code, name, is_system}; the registry CRUD and the
-- settings page manage `is_active` (deactivate-not-delete) and sort by recency,
-- so add them symmetrically with supplier_type. Additive, defaulted, idempotent.
ALTER TABLE client_type
  ADD COLUMN IF NOT EXISTS is_active  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- ── Seed: client categories (2.5 / 6.2) ────────────────────────────────────
INSERT INTO client_type (code, name, is_system) VALUES
  ('SHIPPER','Shipper',true),
  ('CONSIGNEE','Consignee',true),
  ('BOTH','Both',true),
  ('BUSINESS_PARTNER','Business Partner',true)
ON CONFLICT (code) DO NOTHING;

-- ── Seed: supplier categories (2.5 / 6.3, legacy list) ─────────────────────
INSERT INTO supplier_type (code, name, is_system) VALUES
  ('TRANSPORTER','Transporter',true),
  ('SHIPPING_LINE','Shipping Line',true),
  ('CUSTOMS_BROKER','Customs Broker',true),
  ('AIRLINE','Airline',true),
  ('WATER_SUPPLIER','Water Supplier',true),
  ('ELECTRICITY_SUPPLIER','Electricity Supplier',true),
  ('INTERNET_SUPPLIER','Internet Supplier',true),
  ('OFFICE_MAINTENANCE','Office Maintenance',true),
  ('OFFICE_SUPPLIES','Office Supplies',true),
  ('PORT_RTC','Port / RTC',true),
  ('CUSTOMS','Customs',true),
  ('SGS','SGS',true),
  ('SERVICE_PROVIDER','Service Provider',true),
  ('OTHER','Other',true)
ON CONFLICT (code) DO NOTHING;

-- ── Seed: KYC / compliance document types (2.6) ────────────────────────────
INSERT INTO party_document_type (code, name, applies_to, is_system, requires_expiry, requires_issuing_authority, default_severity) VALUES
  ('TAXPAYER_CARD','Taxpayer Card (NIU)','BOTH',true,false,true,'ESCALATED'),
  ('BUSINESS_LICENSE','Business Licence / RCCM','BOTH',true,true,true,'ESCALATED'),
  ('CONTRACT','Contract / Agreement','BOTH',true,true,false,'WARN'),
  ('BANK_RIB','Bank RIB','BOTH',true,false,false,'ESCALATED'),
  ('INSURANCE','Insurance Certificate','BOTH',true,true,true,'WARN'),
  ('CUSTOMS_AUTHORIZATION','Customs Authorisation','SUPPLIER',true,true,true,'ESCALATED'),
  ('WHT_CERTIFICATE','Withholding-Tax Certificate','SUPPLIER',true,true,true,'ESCALATED'),
  ('TAX_RESIDENCY_CERTIFICATE','Tax Residency Certificate','BOTH',true,true,true,'WARN'),
  ('IDENTIFICATION','Identification (ID / Passport)','BOTH',true,true,false,'ESCALATED'),
  ('POWER_OF_ATTORNEY','Power of Attorney','BOTH',true,true,true,'WARN'),
  ('OTHER','Other','BOTH',false,false,false,'INFO')
ON CONFLICT (code) DO NOTHING;

-- ── Seed: country_profile (generated from packages/shared/data/countries.js) ─
-- (rows are spliced into the VALUES block above, marked __COUNTRY_ROWS__)

-- ── Seed: party_field_config defaults (5.1) ────────────────────────────────
-- Reflects the CURRENT required set: only `name` is mandatory (matching the
-- static Zod schema), everything else is visible-but-optional. A tenant toggles
-- required/visible from Settings → Master Data; with no setup at all this seed
-- is the effective config (acceptance gate 7).
INSERT INTO party_field_config (applies_to, field_key, field_group, is_required, is_visible, sort_order) VALUES
  ('CLIENT','name','IDENTITY',true,true,10),
  ('CLIENT','legal_name','IDENTITY',false,true,20),
  ('CLIENT','trading_name','IDENTITY',false,true,30),
  ('CLIENT','client_type_id','IDENTITY',false,true,40),
  ('CLIENT','industry','IDENTITY',false,true,50),
  ('CLIENT','website','IDENTITY',false,true,60),
  ('CLIENT','niu','IDENTITY',false,true,70),
  ('CLIENT','rccm','IDENTITY',false,true,80),
  ('CLIENT','tax_residency_country','COMPLIANCE',false,true,90),
  ('CLIENT','risk_tier','COMPLIANCE',false,true,100),
  ('CLIENT','registrations','COMPLIANCE',false,true,110),
  ('CLIENT','beneficial_owners','COMPLIANCE',false,true,120),
  ('CLIENT','documents','COMPLIANCE',false,true,130),
  ('CLIENT','contacts.billing','CONTACT',false,true,140),
  ('CLIENT','addresses.registered','ADDRESS',false,true,150),
  ('CLIENT','bank_accounts','BANK',false,true,160),
  ('CLIENT','credit_limit','ACCOUNTING',false,true,170),
  ('CLIENT','payment_terms_days','ACCOUNTING',false,true,180),
  ('CLIENT','is_withholding_agent','ACCOUNTING',false,true,190),
  ('CLIENT','default_currency','ACCOUNTING',false,true,200),
  ('CLIENT','relationship_manager_user_id','IDENTITY',false,true,210),
  ('SUPPLIER','name','IDENTITY',true,true,10),
  ('SUPPLIER','legal_name','IDENTITY',false,true,20),
  ('SUPPLIER','trading_name','IDENTITY',false,true,30),
  ('SUPPLIER','supplier_type_id','IDENTITY',false,true,40),
  ('SUPPLIER','industry','IDENTITY',false,true,50),
  ('SUPPLIER','website','IDENTITY',false,true,60),
  ('SUPPLIER','niu','IDENTITY',false,true,70),
  ('SUPPLIER','rccm','IDENTITY',false,true,80),
  ('SUPPLIER','tax_residency_country','COMPLIANCE',false,true,90),
  ('SUPPLIER','is_non_resident','COMPLIANCE',false,true,100),
  ('SUPPLIER','registrations','COMPLIANCE',false,true,110),
  ('SUPPLIER','beneficial_owners','COMPLIANCE',false,true,120),
  ('SUPPLIER','documents','COMPLIANCE',false,true,130),
  ('SUPPLIER','contacts.operations','CONTACT',false,true,140),
  ('SUPPLIER','addresses.registered','ADDRESS',false,true,150),
  ('SUPPLIER','bank_accounts','BANK',false,true,160),
  ('SUPPLIER','payment_method','ACCOUNTING',false,true,170),
  ('SUPPLIER','payment_terms_days','ACCOUNTING',false,true,180),
  ('SUPPLIER','withholding_rate','ACCOUNTING',false,true,190),
  ('SUPPLIER','default_currency','ACCOUNTING',false,true,200),
  ('SUPPLIER','avl_status','COMPLIANCE',false,true,210)
ON CONFLICT (applies_to, field_key) DO NOTHING;

-- DOWN
-- Additive migration; reverse by dropping what it added (commented so nothing
-- runs by accident). The compliance_flag CHECK reverts to the 0340 three-value
-- form; the new columns and tables drop.
-- ALTER TABLE compliance_flag DROP CONSTRAINT IF EXISTS compliance_flag_severity_check;
-- ALTER TABLE compliance_flag ADD CONSTRAINT compliance_flag_severity_check CHECK (severity IN ('INFO','WARN','RED'));
-- DROP TABLE IF EXISTS supplier_beneficial_owner, client_beneficial_owner,
--   supplier_bank_account, client_bank_account, supplier_address, client_address,
--   supplier_contact, client_contact, supplier_document, client_document,
--   party_registration, party_field_config, party_document_type, country_profile;
-- ALTER TABLE supplier_master DROP COLUMN IF EXISTS supplier_type_id;  -- + the other 2.2 columns
-- DROP TABLE IF EXISTS supplier_type;
-- (client_master / supplier_master ADD COLUMNs are left in place — see DATA 3.5.)
