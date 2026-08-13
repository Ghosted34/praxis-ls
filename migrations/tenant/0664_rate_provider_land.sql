-- ============================================================================
-- TENANT DB — 0664 Land carriers: a haulier is a carrier too.
--
-- WHY THE CHECK IS WIDENED
--
-- 0634 gave rates a real scope — but only at sea and in the air. Its CHECK
-- allows SHIPPING_LINE, AIRLINE, PORT_AUTHORITY, CUSTOMS_AUTHORITY and OTHER,
-- so a third-party trucker or CAMRAIL had nowhere to exist. Seed 9092 shows the
-- consequence: on INLAND and HINTERLAND the haulier is a TEXT field with no
-- facet_role and no column_name — a name typed into details_json, invisible to
-- every rate lookup and spelled three ways by three clerks.
--
-- That is exactly backwards. A domestic haul we subcontract is the case where
-- the rate card matters MOST, because there is no fleet cost to fall back on.
--
-- BARGE and COURIER ride along because they are the same omission one mode
-- over: a Wouri barge and a DHL road leg are both somebody's rate card, and
-- adding them now costs nothing while a second CHECK migration later costs a
-- table rewrite of a constraint that could have said so the first time.
--
-- WHY country_code IS HERE AND NOT WITH THE FORM WORK
--
-- The inline "+ Add carrier" affordance asks for name, kind, country and
-- SCAC/IATA. Three of those exist; country did not. It belongs in the one
-- migration that touches this table rather than in a second ALTER a stage
-- later — the column is inert until a form writes to it either way.
--
-- NOTHING IS SEEDED HERE. A starter list of Cameroonian hauliers would be a
-- guess at somebody else's subcontractors, and an is_system row is harder to
-- retire than to add. CAMRAIL is the one arguable exception and it is still a
-- guess; the inline "+ Add carrier" is the answer instead.
-- ============================================================================

-- Drop-then-add rather than a guarded add alone: the constraint EXISTS and has
-- the wrong body, so an `IF NOT EXISTS` guard on its own would find it and do
-- nothing. Re-running the pair is safe — the drop tolerates its absence and the
-- add is guarded, which is what the idempotency gate asks for.
ALTER TABLE rate_provider DROP CONSTRAINT IF EXISTS chk_rate_provider_kind;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rate_provider_kind') THEN
    ALTER TABLE rate_provider ADD CONSTRAINT chk_rate_provider_kind
      CHECK (kind IN ('SHIPPING_LINE','AIRLINE','TRUCKING','RAIL',
                      'BARGE','COURIER','PORT_AUTHORITY','CUSTOMS_AUTHORITY','OTHER'));
  END IF;
END $$;

-- Nullable, and a bare char(2) with no foreign key — the same shape
-- `client_master` and `supplier_master` use (0480). There is no `country`
-- table in this schema; `country_profile` (0511) is tax configuration for the
-- countries a tenant operates in, not a reference list of the world, and
-- pointing a carrier at it would refuse Maersk for want of a Danish tax profile.
ALTER TABLE rate_provider
  ADD COLUMN IF NOT EXISTS country_code char(2);

-- DOWN
-- The column is additive. The CHECK is not: narrowing it again fails while any
-- row uses one of the new kinds, which is the correct behaviour — repoint or
-- delete those rows first, deliberately, rather than having a migration decide.
--
--   ALTER TABLE rate_provider DROP COLUMN IF EXISTS country_code;
--   ALTER TABLE rate_provider DROP CONSTRAINT IF EXISTS chk_rate_provider_kind;
--   -- DESTRUCTIVE unless every TRUCKING/RAIL/BARGE/COURIER row is gone first.
--   ALTER TABLE rate_provider ADD CONSTRAINT chk_rate_provider_kind
--     CHECK (kind IN ('SHIPPING_LINE','AIRLINE','PORT_AUTHORITY','CUSTOMS_AUTHORITY','OTHER'));
