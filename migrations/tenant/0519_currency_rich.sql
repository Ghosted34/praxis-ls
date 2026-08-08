-- ============================================================================
-- TENANT DB — 0519 currency master audit columns (MOD-08).
--
-- The currency table (0342) carried only what FX resolution needs: code, name,
-- symbol, is_base, decimals, is_active. The Currencies & FX revamp turns each
-- currency into a managed record — added from the ISO-4217 catalogue, edited,
-- activated/deactivated, deleted — and a managed record wants to know WHEN it
-- entered the system and when it last changed. `updated_at` is what the service
-- stamps on every edit/activation/base change so the 360's overview is honest
-- about staleness; `created_at` is the "added on" the same overview shows.
--
-- Everything else the 360 needs — a currency's ISO numeric code and the
-- countries that trade in it — is a fact about the currency, not about THIS
-- tenant's use of it, so it lives in @praxis/shared (data/currencies.js) and is
-- resolved client-side. Only per-tenant state (which currencies are on, which is
-- base, when they changed) belongs in the table.
--
-- Self-guarding (ADD COLUMN IF NOT EXISTS): the migrator sends the file as one
-- implicit transaction, and a column that already exists must not wedge the
-- tenant behind this file. ADD COLUMN ... DEFAULT now() backfills existing rows
-- in the same statement, so the five seeded currencies get a sane timestamp.
-- ============================================================================

ALTER TABLE currency ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE currency ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- DOWN
-- Additive audit columns; dropping them loses only the timestamps, no business data.
--   ALTER TABLE currency DROP COLUMN IF EXISTS updated_at;
--   ALTER TABLE currency DROP COLUMN IF EXISTS created_at;
