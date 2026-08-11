-- ============================================================================
-- TENANT DB — 0635 Operations File: carrier at creation (MOD-29 + MOD-10).
--
-- Closes the loop 0634 opened: expense rates are now scoped to a carrier, but
-- nothing on the dossier said WHICH carrier the job is moving on, so costing
-- had no scope to resolve a rate against and every rate lookup would have had
-- to ask the user again on every line. `dossier.rate_provider_id` is that
-- carrier — picked once at booking (Operations File creation/edit), it feeds
-- every downstream rate lookup for that job's costing lines.
--
-- NULLable and SHIPPING_LINE/AIRLINE only by convention, not by constraint: a
-- dossier may be opened before the carrier is confirmed, and a rate row can
-- still be scoped to an AUTHORITY (PAD/PAK) independently of whichever carrier
-- ends up on the dossier — the FK does not restrict `kind` because both are
-- legitimate, just for different rate lines.
-- ============================================================================

ALTER TABLE dossier ADD COLUMN IF NOT EXISTS rate_provider_id uuid REFERENCES rate_provider(rate_provider_id);
CREATE INDEX IF NOT EXISTS ix_dossier_rate_provider ON dossier(rate_provider_id);

-- DOWN
-- Purely additive: one NULLable FK column and its index. No existing dossier
-- is rewritten.
--
--   DROP INDEX IF EXISTS ix_dossier_rate_provider;
--   ALTER TABLE dossier DROP COLUMN IF EXISTS rate_provider_id;
