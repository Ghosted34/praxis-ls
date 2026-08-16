-- ============================================================================
-- SEED (per tenant schema) — F7 pipeline: the seventh stage, its ordering, and
-- the win probabilities, applied AFTER 9030 has seeded the six default stages.
--
-- WHY THIS FILE EXISTS — the ordering bug it repairs
-- --------------------------------------------------
-- migrations/tenant/0686_sales_crm_f7_pipeline.sql does this work already, and
-- it is correct for a tenant that was provisioned BEFORE it landed. It is not
-- correct for a NEW one. `provisioning.service.migrateTenantDb` applies
-- `files.tenantSchema()` (migrations/tenant/*) and only then
-- `files.tenantSeeds()` (migrations/seeds/90*), so on a fresh database 0686
-- runs against an EMPTY `pipeline_stage`:
--
--   * `UPDATE pipeline_stage SET sort_order = sort_order + 1 WHERE sort_order >= 2`
--     matches no rows, so no gap is opened;
--   * `INSERT … ('PRICING_IN_PROGRESS', 'Pricing', 2, …)` lands at sort_order 2;
--   * every `UPDATE … SET default_probability = n WHERE code = '…'` matches no
--     rows, so none of the six defaults ever gets a probability;
--   * 9030 then inserts NEW 0 · QUALIFIED 1 · PROPOSAL 2 · NEGOTIATION 3 ·
--     WON 4 · LOST 5, colliding with PRICING_IN_PROGRESS at sort_order 2.
--
-- Observed on a tenant provisioned from scratch: PROPOSAL and
-- PRICING_IN_PROGRESS both at sort_order 2, and `default_probability` NULL on
-- six of the seven stages. That is not cosmetic — `opportunity.probability` is
-- derived from `pipeline_stage.default_probability`
-- (opportunity.rules.deriveProbability), so every deal created on a fresh
-- tenant carries a NULL probability and the board's forecast column reads 0.
-- A 10,000,000 XAF deal in NEW reported `weighted_value: 0` instead of
-- 1,000,000.
--
-- 0686 is NOT edited: its hash is in scripts/db/migration-idempotency-baseline
-- and it has already run on the deployed tenants, where it did the right thing.
-- This file reaches both populations — a fresh database (where it runs after
-- 9030 and fixes the collision) and an existing one (where it finds the work
-- already done and changes nothing).
--
-- Idempotent: ON CONFLICT on the insert, `IS NULL` guards on the backfill, and
-- the re-ordering runs only while a duplicate sort_order actually exists.
-- ============================================================================

-- ─── 1. The seventh stage, for a database where 0686 found no rows ──────────
INSERT INTO pipeline_stage (code, name, sort_order, is_won, is_lost, default_probability)
VALUES ('PRICING_IN_PROGRESS', 'Pricing', 2, false, false, 50)
ON CONFLICT (code) DO NOTHING;

-- ─── 2. Probabilities, only where the tenant has not set one ────────────────
-- Same values as 0686 and as opportunity.rules.DEFAULT_STAGES. A tenant that
-- has already tuned a stage keeps its number.
UPDATE pipeline_stage SET default_probability =  10 WHERE code = 'NEW'                 AND default_probability IS NULL;
UPDATE pipeline_stage SET default_probability =  30 WHERE code = 'QUALIFIED'           AND default_probability IS NULL;
UPDATE pipeline_stage SET default_probability =  50 WHERE code = 'PRICING_IN_PROGRESS' AND default_probability IS NULL;
UPDATE pipeline_stage SET default_probability =  70 WHERE code = 'PROPOSAL'            AND default_probability IS NULL;
UPDATE pipeline_stage SET default_probability =  85 WHERE code = 'NEGOTIATION'         AND default_probability IS NULL;
UPDATE pipeline_stage SET default_probability = 100 WHERE code = 'WON'                 AND default_probability IS NULL;
UPDATE pipeline_stage SET default_probability =   0 WHERE code = 'LOST'                AND default_probability IS NULL;

-- ─── 3. The gap 0686 could not open ─────────────────────────────────────────
-- Only when PRICING_IN_PROGRESS actually shares its sort_order with another
-- stage. Everything at or after it moves down one; PRICING_IN_PROGRESS itself
-- stays put, which is what turns 0·1·2·2·3·4·5 into 0·1·2·3·4·5·6 and leaves an
-- already-correct ladder untouched. Ordering stays tenant-tunable
-- (BUILD_CONVENTIONS §6) — this only resolves a collision the tenant did not
-- create.
DO $$
DECLARE pricing_order integer;
BEGIN
  SELECT sort_order INTO pricing_order FROM pipeline_stage WHERE code = 'PRICING_IN_PROGRESS';
  IF pricing_order IS NOT NULL
     AND EXISTS (SELECT 1 FROM pipeline_stage
                  WHERE sort_order = pricing_order AND code <> 'PRICING_IN_PROGRESS') THEN
    UPDATE pipeline_stage
       SET sort_order = sort_order + 1
     WHERE sort_order >= pricing_order
       AND code <> 'PRICING_IN_PROGRESS';
  END IF;
END $$;
