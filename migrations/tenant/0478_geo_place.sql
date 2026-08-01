-- ============================================================================
-- 0478 — geo_place: coordinates for the places a dossier routes through.
--
-- WHY. dossier.pol / dossier.pod are free text ("Douala", "Paris CDG", "Tema").
-- The Control Tower map needs to plot them, and until now NOTHING in the schema
-- mapped a place name to a coordinate — the only lat/long columns were the HR
-- geofence ones (0465 work_site / attendance_log), which hold the tenant's OWN
-- office locations, not ports on a shipping route. Different data, different use.
--
-- SHAPE. Deliberately a near-copy of work_site's coordinate columns
-- (numeric(9,6)) so the two read the same way.
--
-- CACHE, NOT CATALOGUE. This doubles as the geocode cache: the seed below covers
-- the places already in use, and anything unseen is resolved once via Geoapify
-- forward geocoding (services/geoapify.service.forwardGeocode) and written back
-- here. That keeps the free tier (3,000 req/day) irrelevant to render cost — the
-- map never geocodes on load.
--
-- `query_key` is the normalised lookup key (lower, trimmed, punctuation-folded)
-- so "Ndjamena", "N'Djamena" and "N'DJAMENA " all hit one row. `name` keeps the
-- display spelling. `source` records where the coordinate came from so a bad
-- geocode can be found and corrected without re-seeding everything.
--
-- Idempotent: IF NOT EXISTS + ON CONFLICT DO NOTHING, so re-running never
-- clobbers a coordinate an admin has corrected by hand.
-- ============================================================================

CREATE TABLE IF NOT EXISTS geo_place (
  geo_place_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_key    text NOT NULL UNIQUE,          -- normalised: lower/trim/fold
  name         text NOT NULL,                 -- display spelling
  country      text,                          -- ISO-3166 alpha-2 where known
  kind         text CHECK (kind IN ('SEAPORT','AIRPORT','CITY','INLAND','OTHER')),
  latitude     numeric(9,6) NOT NULL,
  longitude    numeric(9,6) NOT NULL,
  source       text NOT NULL DEFAULT 'SEED' CHECK (source IN ('SEED','GEOAPIFY','MANUAL')),
  formatted    text,                          -- provider's formatted address
  resolved_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_geo_place_name ON geo_place (lower(name));

-- Seed: every place currently reachable from seeded/known dossier routes, plus
-- the corridor cities the old hand-drawn map showed. Coordinates are the
-- port/airport itself where that differs meaningfully from the city centre
-- (Paris CDG is the airport, not central Paris; Antwerp is the port).
INSERT INTO geo_place (query_key, name, country, kind, latitude, longitude, source) VALUES
  ('douala',      'Douala',      'CM', 'SEAPORT',   4.048200,   9.700400, 'SEED'),
  ('kribi',       'Kribi',       'CM', 'SEAPORT',   2.936900,   9.910700, 'SEED'),
  ('yaounde',     'Yaoundé',     'CM', 'CITY',      3.848000,  11.502100, 'SEED'),
  ('garoua',      'Garoua',      'CM', 'CITY',      9.301400,  13.396400, 'SEED'),
  ('ndjamena',    'N''Djamena',  'TD', 'CITY',     12.134800,  15.055700, 'SEED'),
  ('bangui',      'Bangui',      'CF', 'CITY',      4.394800,  18.558200, 'SEED'),
  ('libreville',  'Libreville',  'GA', 'SEAPORT',   0.416200,   9.467300, 'SEED'),
  ('antwerp',     'Antwerp',     'BE', 'SEAPORT',  51.260200,   4.402800, 'SEED'),
  ('rotterdam',   'Rotterdam',   'NL', 'SEAPORT',  51.948200,   4.140800, 'SEED'),
  ('le havre',    'Le Havre',    'FR', 'SEAPORT',  49.487100,   0.107600, 'SEED'),
  ('marseille',   'Marseille',   'FR', 'SEAPORT',  43.338800,   5.353500, 'SEED'),
  ('paris cdg',   'Paris CDG',   'FR', 'AIRPORT',  49.009700,   2.547900, 'SEED'),
  ('shanghai',    'Shanghai',    'CN', 'SEAPORT',  31.229200, 121.474400, 'SEED'),
  ('ningbo',      'Ningbo',      'CN', 'SEAPORT',  29.868300, 121.544000, 'SEED'),
  ('guangzhou',   'Guangzhou',   'CN', 'SEAPORT',  23.129200, 113.264400, 'SEED'),
  ('tema',        'Tema',        'GH', 'SEAPORT',   5.667800,  -0.016700, 'SEED'),
  ('lome',        'Lomé',        'TG', 'SEAPORT',   6.137500,   1.212300, 'SEED'),
  ('abidjan',     'Abidjan',     'CI', 'SEAPORT',   5.320000,  -4.016700, 'SEED'),
  ('lagos',       'Lagos',       'NG', 'SEAPORT',   6.455600,   3.394800, 'SEED'),
  ('dubai',       'Dubai',       'AE', 'SEAPORT',  25.276900,  55.296500, 'SEED'),
  ('jebel ali',   'Jebel Ali',   'AE', 'SEAPORT',  25.011900,  55.061000, 'SEED'),
  ('istanbul',    'Istanbul',    'TR', 'SEAPORT',  41.008600,  28.978400, 'SEED'),
  ('mumbai',      'Mumbai',      'IN', 'SEAPORT',  18.941700,  72.835600, 'SEED'),
  ('singapore',   'Singapore',   'SG', 'SEAPORT',   1.264400, 103.822000, 'SEED')
ON CONFLICT (query_key) DO NOTHING;

-- Guarded, unlike most tenant migrations: the file header promises idempotency,
-- and a bare CREATE TRIGGER would break that promise (42710 on a second run).
DROP TRIGGER IF EXISTS trg_geo_place_updated ON geo_place;
CREATE TRIGGER trg_geo_place_updated BEFORE UPDATE ON geo_place
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
