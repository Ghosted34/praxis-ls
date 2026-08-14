-- ============================================================================
-- 0674 — geo_place grows the metadata a VERIFIED place needs.
--
-- WHY. 0478 created geo_place as a geocode cache: a name, a coordinate, and a
-- `source` recording where the coordinate came from. That was enough to plot a
-- lane on the Control Tower map. It is not enough to answer the question an
-- operator actually asks in a Monday meeting — "is this the right Douala?" —
-- because the table cannot distinguish:
--
--   * a curated port row somebody reviewed, from a provider guess nobody read;
--   * the terminal itself, from a nearby reference point used because the
--     terminal was not in any catalogue;
--   * an active place, from one that should no longer be offered;
--   * two identically-named places in different countries.
--
-- Every column below exists to make one of those distinctions storable, so the
-- picker can show it and the save path can refuse an unverified movement leg.
--
-- ADDITIVE ONLY. 0478 is applied everywhere and is not touched. Existing rows
-- keep their coordinates, their `source`, and any hand correction an admin has
-- made; the defaults below describe exactly what those rows already are (an
-- active, non-reference point whose code and provider id are unknown).
--
-- THE TWO CHECK CONSTRAINTS ARE REPLACED, NOT EDITED. `kind` and `source` were
-- declared inline in 0478, so Postgres named them itself and the vocabulary
-- cannot be widened with an ALTER. They are dropped by catalogue lookup (the
-- generated name differs between a database provisioned from 0478 and one that
-- has already run this file) and re-added under owned names, which is what makes
-- this re-runnable. No row is rewritten and no value is invalidated: both new
-- vocabularies are supersets of the old ones.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, and the
-- constraint swap is guarded on pg_constraint.
-- ============================================================================

-- ── Codes and provenance ────────────────────────────────────────────────────

-- UN/LOCODE, the five-character code the freight world already agrees on
-- (CMDLA, NLRTM, SGSIN). Nullable because a customer's warehouse door has no
-- code and never will; it is the ports and airports that carry one.
ALTER TABLE geo_place ADD COLUMN IF NOT EXISTS unlocode text;

-- Sub-national region/state, for telling Springfield from Springfield. Country
-- alone does not do it in large federal countries.
ALTER TABLE geo_place ADD COLUMN IF NOT EXISTS region text;

-- The provider's own id for a cached result, so a re-search recognises the row
-- it already has instead of writing a near-duplicate under a different spelling.
ALTER TABLE geo_place ADD COLUMN IF NOT EXISTS provider_place_id text;

-- Provider result quality, 0..1, as reported. Stored rather than acted on: it
-- is shown to the operator confirming a result, and it is deliberately NOT a
-- threshold the code applies, because a confident wrong answer and a hesitant
-- right one are both common and only a human can tell them apart here.
ALTER TABLE geo_place ADD COLUMN IF NOT EXISTS confidence numeric(4,3);

-- ── Verification state ──────────────────────────────────────────────────────

-- TRUE = "this is not the exact place, it is a point near it that we agreed to
-- use". The delivery instructions live on the dossier; this flag stops the map
-- and the itinerary from claiming precision nobody promised. The whole reason
-- the nearby-reference-point flow can exist without lying.
ALTER TABLE geo_place ADD COLUMN IF NOT EXISTS is_reference_point boolean NOT NULL DEFAULT false;

-- Soft retirement. A place already referenced by open files cannot be deleted,
-- so a terminal that closed is deactivated: it stops being offered by search
-- and keeps resolving for the dossiers that already point at it.
ALTER TABLE geo_place ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- When a human last confirmed this place. NULL on rows that arrived by
-- background geocoding, which is precisely the population the location-needed
-- queue is built from.
ALTER TABLE geo_place ADD COLUMN IF NOT EXISTS verified_at timestamptz;

-- Where a catalogue row came from, in words. Licence and provenance for the
-- bundled dataset are recorded here per row rather than only in a migration
-- comment, so a place can be audited from the database it lives in.
ALTER TABLE geo_place ADD COLUMN IF NOT EXISTS provenance text;

-- ── Vocabularies, widened ───────────────────────────────────────────────────

-- `kind` gains the place types a door-to-door file needs to name. TERMINAL is
-- the inland/dry terminal an inland leg ends at; WAREHOUSE is a custody
-- location a Warehousing file is about; ADDRESS is a customer door; RAIL_TERMINAL
-- and BORDER_POST are the two corridor points a hinterland transit crosses.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'geo_place'::regclass
       AND contype = 'c'
       AND conname <> 'chk_geo_place_kind'
       AND pg_get_constraintdef(oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE geo_place DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_geo_place_kind') THEN
    ALTER TABLE geo_place ADD CONSTRAINT chk_geo_place_kind CHECK (kind IN (
      'SEAPORT','AIRPORT','CITY','INLAND',
      'TERMINAL','RAIL_TERMINAL','BORDER_POST','WAREHOUSE','ADDRESS',
      'OTHER'
    ));
  END IF;
END $$;

-- `source` gains CATALOGUE: a reviewed reference row, distinct from SEED (the
-- handful of places 0478 needed to plot the lanes that already existed) and
-- from GEOAPIFY (a provider answer). MANUAL keeps its existing meaning and its
-- existing protection — resolveMany must never overwrite a hand correction.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'geo_place'::regclass
       AND contype = 'c'
       AND conname <> 'chk_geo_place_source'
       AND pg_get_constraintdef(oid) ILIKE '%source%'
  LOOP
    EXECUTE format('ALTER TABLE geo_place DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_geo_place_source') THEN
    ALTER TABLE geo_place ADD CONSTRAINT chk_geo_place_source CHECK (
      source IN ('SEED','CATALOGUE','GEOAPIFY','MANUAL')
    );
  END IF;
END $$;

-- UN/LOCODE is a code, not prose: store it one way so a search for "cmdla"
-- and one for "CMDLA" are the same search.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_geo_place_unlocode') THEN
    ALTER TABLE geo_place ADD CONSTRAINT chk_geo_place_unlocode CHECK (
      unlocode IS NULL OR unlocode ~ '^[A-Z]{2}[A-Z0-9]{3}$'
    );
  END IF;
END $$;

-- ── Search indexes ──────────────────────────────────────────────────────────
--
-- The picker's ranking is exact code → exact name → prefix → contains, and the
-- catalogue is global, so every one of those needs an index or the first
-- keystroke sequential-scans the whole table.

-- Codes are looked up as a whole and are unique in practice but NOT declared
-- unique here: UN/LOCODE assigns one code to a locality, and a locality can
-- hold both a seaport row and an airport row (CMDLA is the port and the city).
CREATE INDEX IF NOT EXISTS ix_geo_place_unlocode ON geo_place (unlocode) WHERE unlocode IS NOT NULL;

-- Country and kind are the two filters the picker offers, and they are almost
-- always applied together ("airports in France").
CREATE INDEX IF NOT EXISTS ix_geo_place_country_kind ON geo_place (country, kind);

-- Prefix matching on the normalised key: `query_key LIKE 'doua%'` uses this,
-- text_pattern_ops being what makes a LIKE prefix indexable at all.
CREATE INDEX IF NOT EXISTS ix_geo_place_query_key_prefix ON geo_place (query_key text_pattern_ops);

-- Substring matching ("kribi" inside "port autonome de kribi"). pg_trgm is
-- installed by 0001_extensions.sql; the guard is here because a tenant restored
-- from an older dump may predate it, and a missing index degrades the search to
-- exact+prefix rather than breaking it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS ix_geo_place_name_trgm ON geo_place USING gin (query_key gin_trgm_ops);
  END IF;
END $$;

-- Backfill the state the existing rows are already in, stated explicitly rather
-- than left to the column default: rows that a human curated or corrected are
-- verified, and the ones a geocoder produced are not. This is what puts every
-- silently-geocoded legacy place into the location-needed queue on day one.
UPDATE geo_place SET verified_at = COALESCE(verified_at, created_at)
 WHERE verified_at IS NULL AND source IN ('SEED','MANUAL');

-- DOWN
-- DROP INDEX IF EXISTS ix_geo_place_name_trgm;
-- DROP INDEX IF EXISTS ix_geo_place_query_key_prefix;
-- DROP INDEX IF EXISTS ix_geo_place_country_kind;
-- DROP INDEX IF EXISTS ix_geo_place_unlocode;
-- ALTER TABLE geo_place DROP CONSTRAINT IF EXISTS chk_geo_place_unlocode;
-- ALTER TABLE geo_place DROP CONSTRAINT IF EXISTS chk_geo_place_source;
-- ALTER TABLE geo_place DROP CONSTRAINT IF EXISTS chk_geo_place_kind;
-- ALTER TABLE geo_place ADD CONSTRAINT geo_place_source_check CHECK (source IN ('SEED','GEOAPIFY','MANUAL'));
-- ALTER TABLE geo_place ADD CONSTRAINT geo_place_kind_check CHECK (kind IN ('SEAPORT','AIRPORT','CITY','INLAND','OTHER'));
-- ALTER TABLE geo_place DROP COLUMN IF EXISTS provenance;
-- ALTER TABLE geo_place DROP COLUMN IF EXISTS verified_at;
-- ALTER TABLE geo_place DROP COLUMN IF EXISTS is_active;
-- ALTER TABLE geo_place DROP COLUMN IF EXISTS is_reference_point;
-- ALTER TABLE geo_place DROP COLUMN IF EXISTS confidence;
-- ALTER TABLE geo_place DROP COLUMN IF EXISTS provider_place_id;
-- ALTER TABLE geo_place DROP COLUMN IF EXISTS region;
-- ALTER TABLE geo_place DROP COLUMN IF EXISTS unlocode;
--
-- NOTE: the DOWN above restores the 0478 vocabularies, which will FAIL if any
-- row has since been written with a widened `kind` or `source` value. Delete or
-- re-classify those rows first — the constraint is the point, so silently
-- coercing them would be worse than the error.
