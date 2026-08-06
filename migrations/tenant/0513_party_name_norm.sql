-- ============================================================================
-- 0513 — Normalized party name (`name_norm`) for country-first forms + dedup.
--
-- PR3-B. The create/edit services now persist a normalized form of each party's
-- name on write — lower-cased, trimmed, internal whitespace collapsed — so the
-- deduplication detection landing in PR3-C has a deterministic key to match on
-- (and a place to hang a pg_trgm index later). Populated on every write by the
-- master services; backfilled here for existing rows.
--
-- ADDITIVE + idempotent: `ADD COLUMN IF NOT EXISTS`, and a backfill guarded by
-- `WHERE name_norm IS NULL` so a re-run is a no-op.
-- ============================================================================

ALTER TABLE client_master   ADD COLUMN IF NOT EXISTS name_norm text;
ALTER TABLE supplier_master ADD COLUMN IF NOT EXISTS name_norm text;

-- Backfill existing rows with the same normalization the service applies on
-- write (lower / trim / collapse runs of whitespace to a single space). Prefer
-- the legal name, falling back to the display name.
UPDATE client_master
   SET name_norm = lower(regexp_replace(trim(coalesce(legal_name, name, '')), '\s+', ' ', 'g'))
 WHERE name_norm IS NULL;
UPDATE supplier_master
   SET name_norm = lower(regexp_replace(trim(coalesce(legal_name, name, '')), '\s+', ' ', 'g'))
 WHERE name_norm IS NULL;

-- DOWN
-- Additive; reverse by dropping the column (commented so nothing runs it by
-- accident). The pg_trgm index that will sit on top of this lands in PR3-C.
-- ALTER TABLE client_master   DROP COLUMN IF EXISTS name_norm;
-- ALTER TABLE supplier_master DROP COLUMN IF EXISTS name_norm;
