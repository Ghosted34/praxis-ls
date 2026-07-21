-- ============================================================================
-- SEED (PLATFORM DB) — corrective: turn on the features whose modules are built.
--
-- Why this file exists as well as the edit in 9110.
-- Platform seeds are applied by migrator.applyTracked() with scope
-- 'platform-seed', which skips any filename already recorded in
-- public.schema_migration. 9110 is already recorded on every existing
-- environment, so editing it only affects databases created from scratch.
-- This file carries the same change forward to databases that already exist.
--
-- What was wrong. provisioning.service.js projectFeatures() resolves a tenant's
-- feature_state as:
--
--   CASE WHEN ov.state IS NOT NULL THEN ov.state
--        WHEN pf.included          THEN fc.default_state
--        ELSE 'off' END
--
-- Being included in the plan defers to default_state rather than turning the
-- feature on, so a tenant on the *full* plan (which includes every feature)
-- still inherited default_state='off' for these nine keys. Because
-- requireFeature (middleware/feature-gate.js) is mounted in front of the whole
-- router by module-loader.js and has NO bypass — not even for the CEO, who
-- bypasses RBAC — that left 19 built, mounted modules returning
-- 403 FEATURE_DISABLED for every user in the tenant:
--
--   fleet             x6 modules      wms              x3 modules
--   wms.inventory     x2 modules      fleet.maintenance x1
--   wms.cycle_count   x1              hr.recruitment    x1
--   hr.appraisals     x1              hr.training       x1
--   finance.debt      x1
--
-- Still 'off' on purpose: ai.* (opt-in by design — the FE AI gate fails safe,
-- see doc/AI_GATE_BE_HANDOFF.md) and portal.* (external client/investor/auditor
-- access is a security decision, not a build-state one).
--
-- AFTER APPLYING THIS you must re-project into the tenant databases, because
-- feature_state is a per-tenant projection of this table and is not recomputed
-- on read:  npm run db:migrate:tenants   (migrateTenant -> projectFeatures)
-- Verify with: node scripts/tenant/feature-report.js --slug=<slug>
--
-- Idempotent. Does not touch any tenant that has an explicit
-- platform.tenant_feature_override — overrides still win at projection time.
-- ============================================================================

UPDATE platform.feature_catalogue
   SET default_state = 'on'
 WHERE feature_key IN (
         'fleet',
         'fleet.maintenance',
         'wms',
         'wms.inventory',
         'wms.cycle_count',
         'hr.recruitment',
         'hr.appraisals',
         'hr.training',
         'finance.debt'
       )
   AND default_state <> 'on';
