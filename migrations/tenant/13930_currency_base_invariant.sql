-- ============================================================================
-- TENANT DB — 13930 Currency base-currency invariant (MOD-08, Currency audit #7).
--
-- 0342 declared `currency.is_base boolean` but added NO database-level guard that
-- exactly one currency is the base. `getBaseCode()` used `LIMIT 1`, so a tenant
-- that had drifted to TWO bases (a bad backfill, a half-applied set-base) would
-- silently resolve FX against whichever row Postgres returned first, and a tenant
-- with ZERO bases would resolve nothing — both invisible until a treasurer
-- noticed the wrong numbers. This migration makes the invariant real:
--
--   1. REPAIR legacy state deterministically, in a DO block so it is idempotent:
--        · >1 base  → keep one (prefer XAF, else the lowest code), unflag the rest;
--        · 0 bases  → adopt one (prefer XAF if present, else the lowest active
--                     code, else the lowest code) so FX always has an anchor;
--        · base off → a base must be usable, so force the surviving base active.
--   2. ENFORCE at most one base with a PARTIAL UNIQUE INDEX. This is an index,
--      not a table CONSTRAINT, so it is legal above 13791 (the constraint-
--      ordering rule only copies contype 'c'/'f'; an index is neither) and it is
--      idempotent via CREATE UNIQUE INDEX IF NOT EXISTS.
--   3. INDEX the base lookup so `WHERE is_base` never scans the table.
--
-- Additive + idempotent (13791 rule / tests/unit/migration-constraint-ordering):
-- the pre-existing `currency` table gains NO CHECK/FK here — the single-base rule
-- lives in a partial unique index and in currency.service/currency.repo, and the
-- "base must be active" rule is enforced in the service (editCurrency refuses to
-- deactivate the base). The repair below only rewrites `is_base`/`is_active`
-- flags; it never deletes a currency or touches rate history.
-- ============================================================================

-- ── 1 · Deterministic repair of zero / multiple / inactive base states ───────
DO $$
DECLARE
  keep char(3);
BEGIN
  -- Pick the base we will KEEP: an existing base wins (prefer XAF among several),
  -- otherwise adopt one (XAF, else lowest active code, else lowest code overall).
  SELECT code INTO keep FROM currency
   WHERE is_base = true
   ORDER BY (code = 'XAF') DESC, code
   LIMIT 1;

  IF keep IS NULL THEN
    SELECT code INTO keep FROM currency
     ORDER BY (code = 'XAF') DESC, is_active DESC, code
     LIMIT 1;
  END IF;

  -- No currencies at all (a bare tenant mid-seed): nothing to anchor, leave it.
  IF keep IS NOT NULL THEN
    -- Exactly one base, and it is active: normalise every other row to is_base=false
    -- and force the kept row base+active in a single pass.
    UPDATE currency
       SET is_base   = (code = keep),
           is_active = CASE WHEN code = keep THEN true ELSE is_active END,
           updated_at = now()
     WHERE is_base <> (code = keep)
        OR (code = keep AND is_active = false);
  END IF;
END $$;

-- ── 2 · At most one base, enforced by Postgres ───────────────────────────────
-- A partial unique index on the constant `is_base` value across only the base
-- rows: two rows with is_base=true would collide. This is what makes a second
-- base impossible even under a concurrent set-base race.
CREATE UNIQUE INDEX IF NOT EXISTS ux_currency_single_base
  ON currency ((is_base)) WHERE is_base;

-- ── 3 · Fast base lookup ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ix_currency_is_base ON currency (is_base) WHERE is_base;

-- DOWN
-- Drops the guard index and the lookup index; the repaired flag values remain
-- (they are correct data, not this migration's invention) and no business data
-- is lost. The single-base rule then falls back to the service layer alone.
--   DROP INDEX IF EXISTS ux_currency_single_base;
--   DROP INDEX IF EXISTS ix_currency_is_base;
