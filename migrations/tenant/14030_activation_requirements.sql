-- ============================================================================
-- TENANT DB — 14030 "Required to activate" — an activation requirement that is
-- a DIFFERENT question from "required", and the ACF exemption for a party
-- operating outside Cameroon.
--
-- ── WHY A SECOND FLAG, NOT A CHANGE TO is_required ─────────────────────────
--
-- `party_document_type.is_required` (0512) answers ONE question: "does this
-- tenant want this document on file?" Everything downstream then read that
-- answer as an ACTIVATION requirement — a missing `is_required` type was tagged
-- an onboarding gap, rendered under "Required to activate" on the 360, and
-- counted by `canVerify`, the gate the verification POST consults (Hard Rule 9).
--
-- Two different questions were being answered by one flag. The cost was a Bank
-- RIB: the account a client will be PAID INTO is collected when the first
-- payment is set up, not when the client is opened — yet BANK_RIB was seeded
-- required in 0512, so every brand-new client read
--
--     Required to activate — Missing Bank RIB
--
-- before it had ever been invoiced. So the two questions get two flags:
--
--   is_required             → ADVISORY. Reported when absent (never louder
--                             than WARN), never a reason a party cannot be
--                             activated, never on the activation checklist.
--   required_for_activation → the ACTIVATION SET. It IS the 360's "Required to
--                             activate" checklist, and it IS what the
--                             verification gate requires (compliance.rules.js
--                             `canVerify` / `activationTypes`).
--
-- Both are tenant configuration, per side (`party_document_type.applies_to`
-- names the side; `party_field_config.applies_to` is CLIENT or SUPPLIER), and
-- both are editable from Settings → Master Data.
--
-- ── DEFAULTS (the owner's rule, applied here) ──────────────────────────────
--
--   ACF  (Attestation de conformité fiscale — seeded by 13900 as code
--         FISCAL_COMPLIANCE, whose name IS the ACF) → required to activate,
--         EXEMPT OUTSIDE CM.
--   BUSINESS_LICENSE (RCCM)                      → required to activate, both
--         sides (the row is seeded applies_to = 'BOTH').
--   BANK_RIB                                     → NOT required to activate,
--         and not advisory either: `is_required` is cleared, so it is tracked
--         if supplied and silent when absent.
--   every other type                             → false; each tenant opts in.
--   fields (party_field_config)                  → false for every field;
--         `name` stays ALWAYS REQUIRED as today, which is `is_required`, not
--         this flag.
--
-- ── THE ACF EXEMPTION, AND THE MECHANISM IT USES ───────────────────────────
--
-- The ACF is what a counterparty TAX RESIDENT (or operating) in Cameroon owes.
-- A foreign company operating outside Cameroon owes its own jurisdiction's
-- equivalent instead, so the document is exempt for it.
--
-- `applies_to_countries` cannot express that: it is a positive membership list
-- where an empty/NULL scope means "applies to everyone" (compliance.rules.js
-- `scopeMatches`), so "everyone except outside-CM" has no representation.
--
-- `exempt_outside_country char(2)` does:
--
--   NULL  → no exemption at all (the default for every other type).
--   'CM'  → the type applies when the party's country / tax residency is CM
--           **or is unknown**, and is exempt when the party's country is
--           PROVABLY outside CM.
--
-- Unknown NEVER exempts. "We do not know where this party is" is not evidence
-- that it does not owe the document, and an exemption that fires on a blank
-- field is how a compliance gate quietly stops gating.
--
-- The rule lives in ONE place — `docTypeApplies` in
-- src/modules/master/compliance/compliance.rules.js — so the checklist, the
-- verification gate and the seed below cannot disagree.
--
-- ── ADDITIVE + IDEMPOTENT ──────────────────────────────────────────────────
--
-- The migrator applies this whole set TWICE and asserts a no-op: every
-- statement is either `ADD COLUMN IF NOT EXISTS`, an UPDATE guarded on the
-- value it sets, or an INSERT … ON CONFLICT. Per the 13791 rule
-- (tests/unit/migration-constraint-ordering.test.js) the two EXISTING tables
-- gain PLAIN columns only — the exemption is a char(2) the rules read, not a
-- CHECK, because a CHECK added above 13791 breaks the sandbox pass of a fresh
-- tenant.
-- ============================================================================

-- ── 1. party_document_type — the activation set + the exemption ────────────
ALTER TABLE party_document_type
  ADD COLUMN IF NOT EXISTS required_for_activation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exempt_outside_country   char(2);

COMMENT ON COLUMN party_document_type.required_for_activation IS
  'The ACTIVATION set: a type flagged here must be on file before the party can be verified/activated, and its gap shows under "Required to activate" on the 360. Distinct from is_required, which is advisory-only (reported, never gating). Tenant-configurable per side (applies_to).';

COMMENT ON COLUMN party_document_type.exempt_outside_country IS
  'ISO-3166 alpha-2 jurisdiction. NULL = no exemption. ''CM'' = applies to a party whose country/tax residency is CM or unknown, exempt for a party provably outside it (ACF). Read by compliance.rules.js docTypeApplies.';

-- ── 2. party_field_config — the same question, for FIELDS ──────────────────
-- `is_required` is enforced when the record is CREATED (master_config
-- .enforceRequired); this one is enforced when the party is ACTIVATED
-- (master_config.missingActivationFields, consulted by the verification gate).
ALTER TABLE party_field_config
  ADD COLUMN IF NOT EXISTS required_for_activation boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN party_field_config.required_for_activation IS
  'A field the party must carry to be ACTIVATED, as opposed to is_required (must be present to CREATE it). Enforced at the verification/activation gate and surfaced on the 360 checklist.';

-- ── 3. ACF — required to activate, exempt outside Cameroon ─────────────────
-- 13900 seeded the row as FISCAL_COMPLIANCE with required = true. The short
-- code ACF is accepted as well so an estate that renamed or re-seeded it is
-- still covered by this statement.
UPDATE party_document_type
   SET required_for_activation = true,
       exempt_outside_country   = 'CM'
 WHERE code IN ('FISCAL_COMPLIANCE', 'ACF')
   AND (required_for_activation = false OR exempt_outside_country IS DISTINCT FROM 'CM');

-- 13900 seeded the ACF row with is_system = false, so a tenant may have
-- DELETED it. Restore it once where neither code exists — guarded, so an estate
-- that still has the row is untouched, and ON CONFLICT keeps a re-run a no-op.
INSERT INTO party_document_type
  (code, name, applies_to, is_system, requires_expiry, requires_issuing_authority,
   default_severity, is_required, required_for_activation, exempt_outside_country)
SELECT 'FISCAL_COMPLIANCE',
       'Attestation of Fiscal Compliance (Attestation de conformité fiscale)',
       'CLIENT', false, true, true, 'ESCALATED', true, true, 'CM'
 WHERE NOT EXISTS (
   SELECT 1 FROM party_document_type WHERE code IN ('FISCAL_COMPLIANCE', 'ACF')
 )
ON CONFLICT (code) DO NOTHING;

-- ── 4. BUSINESS_LICENSE (RCCM) — required to activate, both sides ──────────
UPDATE party_document_type
   SET required_for_activation = true
 WHERE code = 'BUSINESS_LICENSE'
   AND required_for_activation = false;

-- ── 5. BANK_RIB — tracked if supplied, NEVER an activation requirement ─────
-- Two statements on purpose: the first is the product rule (it must not gate
-- activation even where a tenant had already flipped the new column), the
-- second mirrors 0512's `is_required = true` seed so the seeded estate reads
-- exactly as the rule intends.
UPDATE party_document_type
   SET required_for_activation = false
 WHERE code = 'BANK_RIB'
   AND required_for_activation = true;

UPDATE party_document_type
   SET is_required = false
 WHERE code = 'BANK_RIB'
   AND is_required = true;

-- DOWN
-- Additive migration; reverse by dropping what it added, then restoring the
-- pre-14030 advisory state of the two types it re-flagged (0512 seeded
-- BANK_RIB is_required = true and no required_for_activation existed).
-- ALTER TABLE party_document_type
--   DROP COLUMN IF EXISTS required_for_activation, DROP COLUMN IF EXISTS exempt_outside_country;
-- ALTER TABLE party_field_config DROP COLUMN IF EXISTS required_for_activation;
-- UPDATE party_document_type SET is_required = true WHERE code = 'BANK_RIB' AND is_required = false;
-- DELETE FROM party_document_type
--  WHERE code = 'FISCAL_COMPLIANCE' AND is_system = false AND applies_to = 'CLIENT'
--    AND NOT EXISTS (SELECT 1 FROM client_document cd WHERE cd.document_type_id = party_document_type.document_type_id)
--    AND NOT EXISTS (SELECT 1 FROM supplier_document sd WHERE sd.document_type_id = party_document_type.document_type_id);
