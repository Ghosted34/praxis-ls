-- ============================================================================
-- TENANT — 12754 The clearance clock: which two stages a duration is measured
-- between.
--
-- ── WHY THIS IS NOT A CONSTANT ─────────────────────────────────────────────
-- A logistics company advertises "average customs clearance: 72 hours". The
-- arithmetic is trivial — one milestone's completed_at minus another's,
-- averaged. The whole difficulty is WHICH TWO, and it is a commercial question
-- rather than a technical one. Taking the codes this database already seeds:
--
--   DECLARATION_LODGED → CUSTOMS_RELEASED   only the window the forwarder
--                                            controls
--   ARRIVAL            → CUSTOMS_RELEASED   includes the client being slow with
--                                            documents, and the customs queue
--   DOCS_VERIFIED      → CUSTOMS_RELEASED   starts once paperwork is complete
--   ARRIVAL            → DELIVERY           port to door, not clearance at all
--
-- Those produce very different numbers, and the largest is the least flattering
-- for reasons that are not the forwarder's doing. Choosing on their behalf would
-- put a figure on a client's public website that nobody could defend when a
-- customer asks how it was measured.
--
-- ── AND IT DIFFERS PER SERVICE TYPE ────────────────────────────────────────
-- Sea runs through DISCHARGE and ARRIVAL, air through FLIGHT_ARRIVED, hinterland
-- transit through BORDER_CROSSING. One hardcoded pair cannot serve them, so the
-- pair is marked ON THE TEMPLATE, per service type, by the people who run the
-- operation — in the template editor they already use. A service type with no
-- pair marked simply does not contribute to the average, which is the correct
-- behaviour for one nobody has defined a clock for.
--
-- The flags sit beside is_anchor / is_target_lock / is_client_visible because
-- they are the same kind of thing: a property of a stage's ROLE in the chain,
-- not of its schedule.
-- ============================================================================

ALTER TABLE milestone_template_stage
  ADD COLUMN IF NOT EXISTS is_clearance_start boolean NOT NULL DEFAULT false;
ALTER TABLE milestone_template_stage
  ADD COLUMN IF NOT EXISTS is_clearance_end   boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN milestone_template_stage.is_clearance_start IS
  'Starts the clearance clock for this service type. At most one per template.';
COMMENT ON COLUMN milestone_template_stage.is_clearance_end IS
  'Stops the clearance clock for this service type. At most one per template.';

-- At most ONE of each per template, enforced rather than merely intended.
--
-- Two starts is not a smaller version of one start: there is no defensible
-- reading of "the average ran from either of these two moments", and the metric
-- would silently pick whichever the planner returned first. A partial unique
-- index makes the ambiguous state unreachable instead of leaving the read path
-- to cope with it.
CREATE UNIQUE INDEX IF NOT EXISTS ux_stage_one_clearance_start
  ON milestone_template_stage (milestone_template_id) WHERE is_clearance_start;
CREATE UNIQUE INDEX IF NOT EXISTS ux_stage_one_clearance_end
  ON milestone_template_stage (milestone_template_id) WHERE is_clearance_end;

-- ============================================================================
-- VERIFY
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'milestone_template_stage'
--      AND column_name LIKE 'is_clearance%';        -- expect 2 rows
--
--   -- ambiguity is refused:
--   UPDATE milestone_template_stage SET is_clearance_start = true
--    WHERE milestone_template_id = '<id>';          -- expect: unique violation
--                                                   -- once more than one row
--
-- DOWN
--   DROP INDEX IF EXISTS ux_stage_one_clearance_end;
--   DROP INDEX IF EXISTS ux_stage_one_clearance_start;
--   ALTER TABLE milestone_template_stage
--     DROP COLUMN IF EXISTS is_clearance_end,
--     DROP COLUMN IF EXISTS is_clearance_start;
--   -- The metric then finds no pair anywhere and resolves to null, and every
--   -- stat bound to it falls back to its literal. Nothing breaks.
-- ============================================================================
