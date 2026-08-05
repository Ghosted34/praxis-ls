-- ============================================================================
-- SEED (per tenant schema) — currencies, ahead of anything that references them.
--
-- WHY THIS FILE EXISTS
--
-- `currency` was seeded in 9030_seed_reference.sql, and `tax_jurisdiction` — a
-- row that names a currency — in 9010_seed_tax.sql. Seeds apply in filename
-- order, so the referencing row was written twenty files BEFORE the row it
-- refers to.
--
-- That was harmless for as long as nothing enforced the relationship. Migration
-- 0499 added `fk_tax_jurisdiction_currency` (audit DATA 1.3 — multi-currency
-- lines were never reconciled to base because nothing tied a currency code to
-- an actual currency), and the latent ordering bug became fatal:
--
--     Failed applying seeds/9010_seed_tax.sql [live-seed]:
--     insert or update on table "tax_jurisdiction" violates foreign key
--     constraint "fk_tax_jurisdiction_currency"
--
-- PROVISIONING A TENANT FROM NOTHING stopped working. Not an upgrade path — a
-- brand-new tenant, which is the one flow that had never been exercised in CI
-- until the migrations job started running (TC-CI6). It is worth being clear
-- that the FK is right and the seed order was wrong: a tax jurisdiction that
-- names a currency the system does not have is exactly the data the constraint
-- exists to refuse.
--
-- WHY A NEW FILE RATHER THAN RENUMBERING 9030
--
-- The migrator keys its ledger on FILENAME, so renaming an applied seed makes
-- it re-run. 9030 has already been applied on every existing tenant. A new file
-- that sorts before 9010 reaches fresh tenants without touching the ones that
-- are already correct.
--
-- The rows are identical to 9030's and both use ON CONFLICT DO NOTHING, so
-- whichever runs first wins and the other is a no-op. 9030's copy is left in
-- place deliberately: removing it would mean editing an applied file for no
-- benefit, and a duplicated idempotent insert costs nothing.
--
-- ROLLBACK: seed data only.
--   DELETE FROM currency WHERE code IN ('XAF','USD','EUR','NGN','CNY');
--   -- refuses if anything references them, which is the point of the FK.
-- ============================================================================

INSERT INTO currency (code, name, symbol, is_base, decimals) VALUES
 ('XAF','CFA Franc BEAC','FCFA',true,0),
 ('USD','US Dollar','$',false,2),
 ('EUR','Euro','€',false,2),
 ('NGN','Nigerian Naira','₦',false,2),
 ('CNY','Chinese Yuan','¥',false,2)
ON CONFLICT DO NOTHING;

-- DOWN
-- DELETE FROM currency WHERE code IN ('XAF','USD','EUR','NGN','CNY');
-- Refuses while anything references them — which is fk_tax_jurisdiction_currency
-- doing its job, and the reason this file exists.
