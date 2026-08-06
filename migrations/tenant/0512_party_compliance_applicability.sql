-- ============================================================================
-- 0512 — Party compliance: document applicability + onboarding state.
--
-- PR3-A (compliance correctness). PR1/2 (0511) built the compliance engine but
-- it flagged EVERY document type as "missing" for EVERY party, so a brand-new
-- DRAFT read as "Escalated — Missing Other / Missing Power of Attorney / Missing
-- Customs Authorisation". This migration gives the engine the two things it
-- needs to stop doing that:
--
--   1. `is_required` on a document type — separate from `default_severity`.
--      A type that is not required is TRACKED IF PRESENT but never raises a
--      missing-document flag (Hard Rule 10: what is required is tenant config).
--   2. applicability — a type can be scoped to categories, countries or a KYC
--      tier, so a customs-authorisation is not "missing" on a water supplier.
--
-- And it adds the neutral `ONBOARDING` compliance_state so a draft whose only
-- open gaps are "collect these documents to activate" is not screaming red.
--
-- Also lays two country-first foundations the create/edit forms (PR3-B) need:
-- a `country_code` on each master (the LEGAL_COLS bridge in
-- party-lifecycle.service already reads it), and the per-party advance/WHT
-- mirror-account columns the accounting service now writes (0512 §5, mirror
-- collision fix).
--
-- ADDITIVE ONLY + idempotent (the CI migrator applies the whole set twice and
-- asserts a no-op): `ADD COLUMN IF NOT EXISTS`, guarded `UPDATE`, and CHECK
-- widenings via `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`.
-- ============================================================================

-- ── 1. party_document_type: required-ness + applicability ──────────────────
ALTER TABLE party_document_type
  ADD COLUMN IF NOT EXISTS is_required          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS applies_to_categories text[],
  ADD COLUMN IF NOT EXISTS applies_to_countries  char(2)[],
  ADD COLUMN IF NOT EXISTS kyc_tier              text
      CHECK (kyc_tier IS NULL OR kyc_tier IN ('BASIC','ENHANCED'));

-- Data fix: OTHER was seeded is_system=true in some estates (0511's seed is
-- ON CONFLICT DO NOTHING, so an earlier system=true row survives). A free-text
-- "Other" is not a system type — a tenant may rename or retire it.
UPDATE party_document_type SET is_system = false WHERE code = 'OTHER' AND is_system = true;

-- Sensible required defaults (tenants toggle the rest in Settings → Master
-- Data). Only the three every counterparty genuinely needs are required; every
-- other type is tracked-if-present until a tenant marks it required.
UPDATE party_document_type SET is_required = true
 WHERE code IN ('TAXPAYER_CARD','BUSINESS_LICENSE','BANK_RIB') AND is_required = false;

-- Applicability seeds: a customs authorisation only applies to customs brokers;
-- insurance to the categories that carry cargo. NULL/empty applies to all.
UPDATE party_document_type
   SET applies_to_categories = ARRAY['CUSTOMS_BROKER']
 WHERE code = 'CUSTOMS_AUTHORIZATION' AND applies_to_categories IS NULL;
UPDATE party_document_type
   SET applies_to_categories = ARRAY['TRANSPORTER','SHIPPING_LINE','AIRLINE']
 WHERE code = 'INSURANCE' AND applies_to_categories IS NULL;

-- ── 2. compliance_state: add the neutral ONBOARDING rung ────────────────────
-- The masters' compliance_state CHECK (0511) allowed OK/WARN/ESCALATED/
-- SOFT_BLOCK_RECOMMENDATION/HARD_BLOCK. Widen both to accept ONBOARDING: a draft
-- whose only open flags are missing-required-doc / scan-pending onboarding gaps
-- reports ONBOARDING (blue, "Required to activate"), not ESCALATED. Real issues
-- (expiry, rejected docs, unverified banks, sanctions, credit, GL mismatch)
-- still escalate. The constraint name is Postgres's generated
-- `<table>_<column>_check`, the same convention 0511 relied on for
-- compliance_flag.
ALTER TABLE client_master DROP CONSTRAINT IF EXISTS client_master_compliance_state_check;
ALTER TABLE client_master ADD CONSTRAINT client_master_compliance_state_check
  CHECK (compliance_state IS NULL OR compliance_state IN
    ('OK','ONBOARDING','WARN','ESCALATED','SOFT_BLOCK_RECOMMENDATION','HARD_BLOCK'));

ALTER TABLE supplier_master DROP CONSTRAINT IF EXISTS supplier_master_compliance_state_check;
ALTER TABLE supplier_master ADD CONSTRAINT supplier_master_compliance_state_check
  CHECK (compliance_state IS NULL OR compliance_state IN
    ('OK','ONBOARDING','WARN','ESCALATED','SOFT_BLOCK_RECOMMENDATION','HARD_BLOCK'));

-- ── 3. country_code — the country-first anchor (PR3-B forms) ────────────────
-- Field #1 of the revamped create form and the driver of the dynamic
-- registration IDs; compliance country-applicability reads it (falling back to
-- tax_residency_country when unset). party-lifecycle's LEGAL_COLS bridge already
-- lists it, so the Smart Copy conversion starts carrying it across.
ALTER TABLE client_master   ADD COLUMN IF NOT EXISTS country_code char(2);
ALTER TABLE supplier_master ADD COLUMN IF NOT EXISTS country_code char(2);

-- ── 4. Per-party mirror-account link columns (accounting §3) ────────────────
-- The advance-received / advance-paid / supplier-WHT mirror accounts were found
-- from the aux account by SHARING ITS 4-DIGIT SUFFIX. That collides once a
-- control account has more than 9999 children (the aux code overflows and the
-- suffix wraps), silently returning another party's mirror account. The
-- accounting service now allocates a collision-free child and records the code
-- here, so the link is explicit rather than positional.
ALTER TABLE client_master   ADD COLUMN IF NOT EXISTS coa_advance_account text REFERENCES chart_of_accounts(code);
ALTER TABLE supplier_master ADD COLUMN IF NOT EXISTS coa_advance_account text REFERENCES chart_of_accounts(code);
ALTER TABLE supplier_master ADD COLUMN IF NOT EXISTS coa_wht_account     text REFERENCES chart_of_accounts(code);

-- DOWN
-- Additive migration; reverse by dropping what it added (commented so nothing
-- runs by accident). compliance_state reverts to the 0511 six-value form.
-- ALTER TABLE party_document_type
--   DROP COLUMN IF EXISTS is_required, DROP COLUMN IF EXISTS applies_to_categories,
--   DROP COLUMN IF EXISTS applies_to_countries, DROP COLUMN IF EXISTS kyc_tier;
-- ALTER TABLE client_master   DROP COLUMN IF EXISTS country_code, DROP COLUMN IF EXISTS coa_advance_account;
-- ALTER TABLE supplier_master DROP COLUMN IF EXISTS country_code,
--   DROP COLUMN IF EXISTS coa_advance_account, DROP COLUMN IF EXISTS coa_wht_account;
-- ALTER TABLE client_master DROP CONSTRAINT IF EXISTS client_master_compliance_state_check;
-- ALTER TABLE client_master ADD CONSTRAINT client_master_compliance_state_check
--   CHECK (compliance_state IS NULL OR compliance_state IN ('OK','WARN','ESCALATED','SOFT_BLOCK_RECOMMENDATION','HARD_BLOCK'));
-- ALTER TABLE supplier_master DROP CONSTRAINT IF EXISTS supplier_master_compliance_state_check;
-- ALTER TABLE supplier_master ADD CONSTRAINT supplier_master_compliance_state_check
--   CHECK (compliance_state IS NULL OR compliance_state IN ('OK','WARN','ESCALATED','SOFT_BLOCK_RECOMMENDATION','HARD_BLOCK'));
