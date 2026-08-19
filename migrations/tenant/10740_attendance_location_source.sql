-- ===========================================================================
-- TENANT DB — 10740 attendance punch location_source
--
-- `within_geofence` is three-valued: true / false / null. Null used to mean
-- two different facts — "we had no GPS" and "we had GPS but the tenant has
-- not defined a worksite" — and the UI painted both as "No fix". That trains
-- people to ignore a missing location, which is the one signal a warn-policy
-- tenant has that the punch is untraceable.
--
-- `location_source` records WHAT WAS PRESENTED at punch time, independently
-- of whether a geofence existed to judge it. Snapshot, not a join: turning
-- worksites on later must not rewrite yesterday's "we never got a fix".
-- ===========================================================================

ALTER TABLE attendance_log
  ADD COLUMN IF NOT EXISTS location_source text
    CHECK (location_source IS NULL OR location_source IN ('gps', 'none'));

COMMENT ON COLUMN attendance_log.location_source IS
  'What the client presented at punch time: gps = coordinates were sent; none = the punch was allowed without a fix. NULL on rows taken before 10740. Independent of within_geofence — a GPS punch against no worksites is still gps.';

-- Existing rows that carried coordinates were GPS punches. Leave the rest NULL
-- rather than guessing "none": a missing column is not the same as a recorded
-- refusal, and backfilling would invent a fact the old client never stated.
UPDATE attendance_log
   SET location_source = 'gps'
 WHERE location_source IS NULL
   AND latitude IS NOT NULL
   AND longitude IS NOT NULL;

-- DOWN
-- ALTER TABLE attendance_log DROP COLUMN IF EXISTS location_source;
