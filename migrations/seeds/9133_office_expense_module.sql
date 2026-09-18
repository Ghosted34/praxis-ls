-- ============================================================================
-- SEED (PLATFORM DB) — catalogue entry for Office Expenses (MOD-77).
--
-- Review 16 Sep 2026 #37: a net-new module for the running costs of the office
-- itself — rent, utilities, supplies, connectivity — which today are either
-- forced through a dossier they do not belong to (polluting file costing) or
-- typed straight into the journal, where the person recording them has to know
-- OHADA account codes. The module gives those costs a home of their own with
-- guided GL posting.
--
-- 91xx = platform seed (migrator.files.platformSeeds), applied once to the
-- platform database. Same shape and intent as 9132_budget_reconciliation.
--
-- CATALOGUE FIRST, THEN GATE. A key absent from platform.module_catalogue has
-- grants for nobody: the permission matrix is built from GET /catalogue/modules,
-- so the row never appears and every non-CEO user 403s forever (the 9130
-- finding, ORGANOGRAMME_AUDIT_2026-08-02 C2).
--
-- group_key must be one of the six workflow verbs or 0070_module_taxonomy's
-- guard raises. Spending money is `transact`, same shelf as MOD-46..49 and the
-- rest of finance.
--
-- Idempotent: safe to re-run.
-- ============================================================================

INSERT INTO platform.module_catalogue (module_key, group_key, name, sort_order, is_core) VALUES
 ('MOD-77','transact','Office Expenses',77,false)
ON CONFLICT (module_key) DO NOTHING;

-- The route gate (office_expense.routes.js) checks feature_state for
-- 'finance.office_expenses'; a feature absent from the catalogue can never be
-- projected on, so the module would 403 for every tenant forever. Default ON,
-- like finance.debt in 9110 — recording the rent is table stakes, not an
-- upsell. Depends on accounting.core because posting writes journal entries.
INSERT INTO platform.feature_catalogue (feature_key, module_key, name, default_state, depends_on) VALUES
 ('finance.office_expenses','MOD-77','Office expenses','on','{accounting.core}')
ON CONFLICT (feature_key) DO UPDATE SET default_state = EXCLUDED.default_state;

-- Include it in the plans that carry the rest of finance (same trio 9110 uses).
INSERT INTO platform.plan_feature (plan_id, feature_key, included)
SELECT p.plan_id, 'finance.office_expenses', true
  FROM platform.plan p
ON CONFLICT (plan_id, feature_key) DO UPDATE SET included = EXCLUDED.included;


-- DOWN
-- Leaving the row is inert; DELETING it is not — feature_catalogue and tenant
-- permission grants reference module_key, so a delete cascades into real
-- permissions (same reasoning as 9132's down block). If this must be undone,
-- revoke the grants first and then:
--
--   DELETE FROM platform.module_catalogue WHERE module_key = 'MOD-77';
