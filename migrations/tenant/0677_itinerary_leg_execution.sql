-- ============================================================================
-- 0677 — an itinerary leg records what HAPPENED, not only what was planned.
--
-- WHY. 0672 created the leg with `planned_departure` and `planned_arrival`, which
-- is enough to draw a route and enough to say a file is late. It is not enough
-- for the question a Monday operations meeting actually asks about a leg —
-- "where is this one now?" — because a leg that departed three days late and
-- arrived on time and a leg that has not moved at all are indistinguishable when
-- only the plan is stored. `status` carries the coarse answer (PLANNED /
-- IN_PROGRESS / …) and a human has to maintain it by hand; the actual dates are
-- the evidence behind it.
--
-- WHAT EACH COLUMN IS FOR, since none of them is obvious from its name alone:
--
--   actual_departure / actual_arrival
--     The two facts that turn a planned route into a tracked one. Dates, not
--     timestamps, matching `planned_*` and the dossier's own `eta`/`ata`: a
--     timestamp implies a precision that a port's "the vessel sailed Tuesday"
--     does not have, and 0478's sibling columns already made that choice.
--
--   milestone_instance_id
--     The link the Control Tower needs to stop having two answers. The milestone
--     engine (0310) already tracks progress stage by stage, and the itinerary
--     tracks it leg by leg; without a join between them the map can say a file is
--     on its main carriage while the milestone list says customs cleared last
--     week. ON DELETE SET NULL, because re-instantiating a milestone chain must
--     not delete the itinerary that referenced it.
--
--   source
--     Whether this leg came from the service type's template or a person added
--     it. The editor needs it to explain itself ("this leg came from the service
--     type") and the required-leg rule needs it to know which legs it is allowed
--     to insist on.
--
-- Additive only. 0672 is applied and is not touched; every existing leg is a
-- planned leg with no actuals, which is exactly what the defaults describe.
-- ============================================================================

ALTER TABLE dossier_itinerary_leg ADD COLUMN IF NOT EXISTS actual_departure date;
ALTER TABLE dossier_itinerary_leg ADD COLUMN IF NOT EXISTS actual_arrival date;
ALTER TABLE dossier_itinerary_leg
  ADD COLUMN IF NOT EXISTS milestone_instance_id uuid
  REFERENCES milestone_instance(milestone_instance_id) ON DELETE SET NULL;

-- MANUAL as the default, deliberately: every leg that already exists was written
-- by `itinerary.replace`, and the ones the template seeded are indistinguishable
-- from hand-added ones on those rows. Claiming TEMPLATE for all of them would
-- let the required-leg rule refuse to delete a leg nobody chose.
ALTER TABLE dossier_itinerary_leg ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'MANUAL';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_itinerary_leg_source') THEN
    ALTER TABLE dossier_itinerary_leg ADD CONSTRAINT chk_itinerary_leg_source
      CHECK (source IN ('TEMPLATE', 'MANUAL'));
  END IF;
END $$;

-- An actual arrival before its own departure is a data-entry slip, and the one
-- that matters: it inverts the leg on any timeline that sorts by date.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_itinerary_leg_actual_order') THEN
    ALTER TABLE dossier_itinerary_leg ADD CONSTRAINT chk_itinerary_leg_actual_order
      CHECK (actual_departure IS NULL OR actual_arrival IS NULL OR actual_arrival >= actual_departure);
  END IF;
END $$;

-- The Control Tower loads every leg for a page of files at once and joins both
-- endpoints to geo_place. Without these the join is a sequential scan per render
-- once a tenant has a few thousand legs.
CREATE INDEX IF NOT EXISTS ix_itinerary_leg_origin_place
  ON dossier_itinerary_leg (origin_place_id) WHERE origin_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_itinerary_leg_destination_place
  ON dossier_itinerary_leg (destination_place_id) WHERE destination_place_id IS NOT NULL;

-- DOWN
-- DROP INDEX IF EXISTS ix_itinerary_leg_destination_place;
-- DROP INDEX IF EXISTS ix_itinerary_leg_origin_place;
-- ALTER TABLE dossier_itinerary_leg DROP CONSTRAINT IF EXISTS chk_itinerary_leg_actual_order;
-- ALTER TABLE dossier_itinerary_leg DROP CONSTRAINT IF EXISTS chk_itinerary_leg_source;
-- ALTER TABLE dossier_itinerary_leg DROP COLUMN IF EXISTS source;
-- ALTER TABLE dossier_itinerary_leg DROP COLUMN IF EXISTS milestone_instance_id;
-- ALTER TABLE dossier_itinerary_leg DROP COLUMN IF EXISTS actual_arrival;
-- ALTER TABLE dossier_itinerary_leg DROP COLUMN IF EXISTS actual_departure;
