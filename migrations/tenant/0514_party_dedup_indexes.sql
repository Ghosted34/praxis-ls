-- ============================================================================
-- 0514 — Deduplication indexes (PR3-C §5.1).
--
-- The dedup detection service scores a candidate counterparty against the
-- existing masters on normalized name similarity, exact tax/legal ID, email and
-- phone. This adds the indexes that keep that lookup cheap:
--   - a pg_trgm GIN index on each master's `name_norm` (populated by PR3-B), so
--     `similarity(name_norm, $1)` and `name_norm % $1` use an index rather than
--     scanning every party;
--   - a btree on `party_registration(number)` for the exact tax-ID probe.
--
-- ADDITIVE + idempotent: `CREATE EXTENSION IF NOT EXISTS`, `CREATE INDEX IF NOT
-- EXISTS`. pg_trgm is installed into `public` (0504 already does this and warns
-- why a bare CREATE EXTENSION lands in the wrong schema); this is a no-op when
-- 0504 has run, and correct when it has not.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;

CREATE INDEX IF NOT EXISTS ix_client_master_name_norm_trgm
  ON client_master USING gin (name_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_supplier_master_name_norm_trgm
  ON supplier_master USING gin (name_norm gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_party_registration_number
  ON party_registration (number);

-- DOWN
-- Additive; reverse by dropping the indexes (commented so nothing runs it by
-- accident). The pg_trgm extension is left in place — other features may rely
-- on it and dropping an extension cascades.
-- DROP INDEX IF EXISTS ix_client_master_name_norm_trgm;
-- DROP INDEX IF EXISTS ix_supplier_master_name_norm_trgm;
-- DROP INDEX IF EXISTS ix_party_registration_number;
