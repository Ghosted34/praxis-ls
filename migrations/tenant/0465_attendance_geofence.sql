-- ============================================================================
-- 0465 — geofenced attendance (MOD-14). Adds worksites (geofence centres) and
-- geo/geofence columns on attendance_log so clock-in/out capture where it
-- happened, whether it was on-site, and a reverse-geocoded address. Idempotent.
-- ============================================================================

-- A worksite is a geofence centre: clock-ins within radius_m are "on-site".
CREATE TABLE IF NOT EXISTS work_site (
  work_site_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid REFERENCES corporate_entity(entity_id),
  name          text NOT NULL,
  latitude      numeric(9,6) NOT NULL,
  longitude     numeric(9,6) NOT NULL,
  radius_m      integer NOT NULL DEFAULT 150 CHECK (radius_m > 0),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_work_site_entity ON work_site(entity_id) WHERE is_active;

-- Clock-in geo (captured device GPS + resolved geofence + address label).
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS latitude        numeric(9,6);
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS longitude       numeric(9,6);
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS accuracy_m      numeric(9,2);
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS work_site_id    uuid REFERENCES work_site(work_site_id);
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS distance_m      numeric(12,2);
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS within_geofence boolean;
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS geo_label       text;

-- Clock-out geo (lighter — where the shift ended).
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS out_latitude      numeric(9,6);
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS out_longitude     numeric(9,6);
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS out_within_geofence boolean;
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS out_geo_label     text;
