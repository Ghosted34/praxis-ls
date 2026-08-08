-- ============================================================================
-- SEED (per tenant schema) — treasury_category default rows + the petty-cash
-- CoA parent (5711), plus a best-effort backfill of category_id on any
-- pre-revamp treasury_account rows.
--
-- WHY A SEED FILE INSTEAD OF DOING THIS IN 0520.
-- The category rows and the 5711 CoA leaf reference SYSCOHADA parents 521 /
-- 571 / 5381 / 5382 via FK to `chart_of_accounts(code)`. Those codes are
-- populated by seeds/9000_seed_coa.sql. Tenant migrations (0001..0520) apply
-- BEFORE seeds — the migrator applies all tenant SQL first, then all seeds in
-- filename order — so INSERTing here from the migration file fails on a
-- fresh-provisioned tenant with:
--
--   Failed applying migrations/tenant/0520_treasury_master_rich.sql [live]:
--   insert or update on table "chart_of_accounts" violates foreign key
--   constraint "chart_of_accounts_parent_code_fkey"
--   DETAIL: Key (parent_code)=(571) is not present in table
--
-- The same shape 9005_seed_currency.sql fixed for the currency ↔
-- tax_jurisdiction FK. Same fix: a new seed file that sorts AFTER 9000, so
-- the parents already exist by the time these inserts run.
--
-- WHY THIS FILE STARTS WITH 90, NOT 91.
-- src/services/platform/migrator.js scopes seeds by filename prefix:
--     tenantSeeds:   /^90/.test(f)      ← this file
--     platformSeeds: /^91/.test(f)      ← platform-DB only
-- The first version of this file was 9101, which routed it to the platform
-- migrator; the platform DB has no chart_of_accounts / treasury_category
-- tables, so it failed with "relation \"chart_of_accounts\" does not exist"
-- during `migrate-platform.js`. 90xx sits it correctly on the tenant path
-- (and after 9000_seed_coa.sql so the FK parents already exist).
--
-- ADDITIVE ONLY. ON CONFLICT DO NOTHING everywhere; safe to re-run.
-- SCHEMA-DUAL. Applied unqualified once per schema (live, then sandbox).
-- ============================================================================

-- ── §1  A dedicated 5711 CoA leaf for petty cash ──────────────────────────
-- Seed 9000 gives us 571 (Caisse siège, non-postable parent) and 5211/5381/5382
-- as postable leaves. There is no parent for petty cash sub-accounts to hang
-- off. Create a 4-digit `5711` "Petty cash" node under 571 — non-postable
-- itself (parents are not postable), so treasury_account's petty-cash leaves
-- (571110, 571111, …) are what get posted to.
INSERT INTO chart_of_accounts
  (code, parent_code, label_fr, label_en, class, normal_balance, is_postable, requires_analytic)
VALUES
  ('5711', '571', 'Caisses régies (petites caisses)', 'Petty cash floats', 5, 'D', false, false)
ON CONFLICT (code) DO NOTHING;

-- ── §2  The five default treasury_category rows ───────────────────────────
INSERT INTO treasury_category
  (code, label, legacy_kind, coa_parent_code, requires_custodian, is_bank_identity, is_momo_identity, is_system)
VALUES
  ('BANK',         'Bank',              'BANK', '521',  false, true,  false, true),
  ('CASH',         'Cash',              'CASH', '571',  false, false, false, true),
  ('PETTY_CASH',   'Petty Cash',        'CASH', '5711', true,  false, false, true),
  ('MTN_MOMO',     'MTN Mobile Money',  'MOMO', '5381', false, false, true,  true),
  ('ORANGE_MONEY', 'Orange Money',      'MOMO', '5382', false, false, true,  true)
ON CONFLICT (code) DO NOTHING;

-- ── §3  Backfill category_id on existing rows ─────────────────────────────
-- The pre-revamp model only distinguished BANK/CASH/MOMO. Best-effort mapping:
--   kind=BANK              → BANK
--   kind=CASH              → CASH   (existing CASH rows were Caisse Siège by
--                                    default — no custodian was ever collected,
--                                    so they cannot be safely promoted to
--                                    PETTY_CASH; the treasurer reclassifies
--                                    them in the UI when a custodian is known)
--   kind=MOMO, momo_network~'MTN'    → MTN_MOMO
--   kind=MOMO, momo_network~'ORANGE' → ORANGE_MONEY
--   kind=MOMO, network unknown       → left NULL; the treasurer sets it in the UI
UPDATE treasury_account a
   SET category_id = c.treasury_category_id
  FROM treasury_category c
 WHERE a.category_id IS NULL
   AND (
        (a.kind = 'BANK' AND c.code = 'BANK')
     OR (a.kind = 'CASH' AND c.code = 'CASH')
     OR (a.kind = 'MOMO' AND c.code = 'MTN_MOMO'     AND UPPER(a.momo_network) LIKE 'MTN%')
     OR (a.kind = 'MOMO' AND c.code = 'ORANGE_MONEY' AND UPPER(a.momo_network) LIKE 'ORANGE%')
   );

-- DOWN
-- Seed data only. Reversal is safe IF no treasury_account has been created
-- against these categories yet; if any exist, delete or reclassify them first
-- (a treasury_account with a null category_id is a legal state — the backfill
-- itself is a no-op for such rows).
--
--   -- Un-backfill (nothing hard-breaks — category_id is nullable):
--   UPDATE treasury_account SET category_id = NULL
--    WHERE category_id IN (
--      SELECT treasury_category_id FROM treasury_category
--       WHERE code IN ('BANK','CASH','PETTY_CASH','MTN_MOMO','ORANGE_MONEY'));
--
--   -- Remove the seeded categories:
--   DELETE FROM treasury_category
--    WHERE code IN ('BANK','CASH','PETTY_CASH','MTN_MOMO','ORANGE_MONEY');
--
--   -- Remove the petty-cash CoA leaf (IF no journal_line references it):
--   DELETE FROM chart_of_accounts WHERE code = '5711';
