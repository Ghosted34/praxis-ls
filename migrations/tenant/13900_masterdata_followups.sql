-- ============================================================================
-- TENANT DB — 13900 Masterdata follow-ups (16 Sep 2026 review §2).
--
--   #29  Supplier payment methods become a LIST. `supplier_master.payment_method`
--        is a single value with a CHECK; a vendor paid by bank transfer for
--        invoices and mobile money for small disbursements could only record
--        one of them. The list is the new canonical field; the scalar stays as
--        a legacy mirror (first entry) so every existing reader — WHT reports,
--        binding context tabs, the 360 — keeps working unchanged.
--
--   #26  Company-level client phone. `client_master` had email (0475) but no
--        phone; the only phone lived on a contact row, so a client created
--        without a contact had no reachable number anywhere. The column is
--        added here and seeded REQUIRED in party_field_config — the review's
--        ask was mandatory-on-creation, and tenants who disagree toggle it off
--        in Settings → Master Data like any other field rule (§5.2).
--
--   #30  Attestation of fiscal compliance as a client document type
--        (Attestation de conformité fiscale / de non-redevance). Cameroon
--        practice: a client without one is a WHT/compliance risk, so it is
--        seeded required with expiry + issuing authority, severity ESCALATED —
--        the same posture as the taxpayer card.
--
-- Additive + idempotent. Per the 13791 rule (tests/unit/
-- migration-constraint-ordering.test.js) the EXISTING tables gain PLAIN columns
-- only — the payment-method enum for the new list is enforced in the shared Zod
-- schema (packages/shared/schemas/supplier-master.js), not by a CHECK.
-- ============================================================================

-- ── #29 · supplier_master.payment_methods ───────────────────────────────────
ALTER TABLE supplier_master ADD COLUMN IF NOT EXISTS payment_methods text[];

COMMENT ON COLUMN supplier_master.payment_methods IS
  'All accepted payment methods (BANK | CASH | MOBILE_MONEY | CHEQUE) — enum enforced in the shared Zod schema per the 13791 rule. payment_method mirrors the first entry for legacy readers.';

-- Backfill: a supplier with a single legacy method reads as a one-item list.
-- Guarded on NULL so a re-run (and a tenant that has already saved a list)
-- is a no-op.
UPDATE supplier_master
   SET payment_methods = ARRAY[payment_method]
 WHERE payment_methods IS NULL
   AND payment_method IS NOT NULL;

-- ── #26 · client_master.phone ───────────────────────────────────────────────
ALTER TABLE client_master ADD COLUMN IF NOT EXISTS phone text;

COMMENT ON COLUMN client_master.phone IS
  'Company-level phone (E.164 preferred). Contact rows keep their own numbers; this is the one the master record itself answers on.';

-- Seeded REQUIRED (the review ask). `enforceRequired` reads party_field_config,
-- so this is policy, not schema — a tenant toggles it in Settings → Master Data.
INSERT INTO party_field_config (applies_to, field_key, field_group, is_required, is_visible, sort_order) VALUES
  ('CLIENT','phone','CONTACT',true,true,145)
ON CONFLICT (applies_to, field_key) DO NOTHING;

-- ── #30 · Attestation of fiscal compliance (client doc type) ────────────────
INSERT INTO party_document_type
  (code, name, applies_to, is_system, requires_expiry, requires_issuing_authority, default_severity, is_required)
VALUES
  ('FISCAL_COMPLIANCE',
   'Attestation of Fiscal Compliance (Attestation de conformité fiscale)',
   'CLIENT', true, true, true, 'ESCALATED', true)
ON CONFLICT (code) DO NOTHING;

-- DOWN
-- ALTER TABLE supplier_master DROP COLUMN IF EXISTS payment_methods;
-- ALTER TABLE client_master DROP COLUMN IF EXISTS phone;
-- DELETE FROM party_field_config WHERE applies_to = 'CLIENT' AND field_key = 'phone';
-- DELETE FROM party_document_type WHERE code = 'FISCAL_COMPLIANCE';
