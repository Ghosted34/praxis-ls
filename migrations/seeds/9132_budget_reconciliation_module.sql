-- ============================================================================
-- SEED (PLATFORM DB) — catalogue entry for Budget Reconciliation (MOD-76).
--
-- 91xx = platform seed (migrator.files.platformSeeds), applied once to the
-- platform database. Same shape and intent as 9130_mail_module.sql.
--
-- WHY A KEY OF ITS OWN (owner decision Q21). `dossier_reconciliation` and
-- `cost_tracking` both declared MOD-47, so a role granted one was granted the
-- other — a grant to RECORD COSTS was also a grant to SETTLE a file's
-- reconciliation. Those are Operations' act and Finance's act respectively, and
-- they are the pair maker-checker most wants apart. 12771 made the same
-- separation at the column level when it split can_validate and can_disburse
-- out of can_approve; this is the module-level half.
--
-- MOD-47 stays with cost tracking, which was there first.
--
-- CATALOGUE FIRST, THEN GATE. A key absent from platform.module_catalogue has
-- grants for nobody: the permission matrix is built from GET /catalogue/modules,
-- so the row never appears and every non-CEO user 403s forever. Same finding
-- 9130 records (ORGANOGRAMME_AUDIT_2026-08-02 C2).
--
-- group_key must be one of the six workflow verbs or 0070_module_taxonomy's
-- guard raises — the ribbon renders one tab per distinct value, so a stray one
-- would appear as a seventh tab with a single module in it. `costing` maps to
-- `transact` (0070:56), which is where MOD-46 through MOD-49 sit.
--
-- Idempotent: safe to re-run.
-- ============================================================================

INSERT INTO platform.module_catalogue (module_key, group_key, name, sort_order, is_core) VALUES
 ('MOD-76','transact','Budget Reconciliation',76,false)
ON CONFLICT (module_key) DO NOTHING;

-- DOWN
-- Leaving the row is inert; DELETING it is not. platform.feature_catalogue and
-- every tenant permission grant reference module_key, so a delete cascades into
-- real permissions — the same reason 0070_module_taxonomy declined to remove
-- MOD-73/74/75 in its own down block. If this must be undone, revoke the grants
-- first and then:
--
--   DELETE FROM platform.module_catalogue WHERE module_key = 'MOD-76';
