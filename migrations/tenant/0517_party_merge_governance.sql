-- ============================================================================
-- 0517 — Governed merge + sensitive-field maker-checker (PR3-C §5.2 / §8).
--
-- Three additive pieces the governed merge and the maker-checker lean on:
--
--   1. party_alias — the trading names a party has been known by. A merge folds
--      the loser's name (and any of its own aliases) in here under the survivor,
--      so a later dedup / search still finds the counterparty by the old name.
--
--   2. merged_into_id — a self-referential pointer on each master recording the
--      survivor a soft-archived loser was merged into. The loser row is NEVER
--      deleted (journal lines, invoices and dossiers reference it); it is
--      archived (registration_status='ARCHIVED', is_active=false) and this
--      column is the audit-legible link to where its data now lives.
--
--   3. party_change_request — the pending-change store for the sensitive-field
--      maker-checker (§8) and the governed merge (§5.2). In LIVE, a bank
--      create/update, a legal-name / tax-registration / credit-limit / status
--      change, or a merge is written here as PENDING and applied only when a
--      SECOND authorizer (not the requester) approves it. In TEST/sandbox the
--      change applies directly and this table stays empty.
--
-- ADDITIVE + idempotent: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS. The migrations CI job applies the whole set twice;
-- every statement here is a no-op on the second pass.
-- ============================================================================

-- ── 1. Aliases (the names a party has traded under) ─────────────────────────
CREATE TABLE IF NOT EXISTS party_alias (
  alias_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_kind  text NOT NULL CHECK (party_kind IN ('client', 'supplier')),
  party_id    uuid NOT NULL,               -- polymorphic (client_master / supplier_master)
  alias       text NOT NULL,               -- a name the party was known by
  alias_norm  text,                        -- normalized form (lower/trim/collapse) for search
  kind        text,                        -- provenance: 'MERGED_NAME', 'FORMER_NAME', 'TRADING_NAME'
  source_ref  text,                        -- e.g. the loser 'client:<id>' a merge folded in
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_party_alias_party ON party_alias (party_kind, party_id);
CREATE INDEX IF NOT EXISTS ix_party_alias_norm  ON party_alias USING gin (alias_norm gin_trgm_ops);

-- ── 2. merged_into_id — the archived loser's pointer to its survivor ─────────
ALTER TABLE client_master
  ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES client_master(client_id);
ALTER TABLE supplier_master
  ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES supplier_master(supplier_id);

-- ── 3. party_change_request — the maker-checker / merge pending store ────────
CREATE TABLE IF NOT EXISTS party_change_request (
  change_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_kind    text NOT NULL CHECK (party_kind IN ('client', 'supplier')),
  party_id      uuid NOT NULL,             -- the party being changed (survivor, for a merge)
  change_type   text NOT NULL CHECK (change_type IN (
                   'BANK_CREATE', 'BANK_UPDATE', 'LEGAL_NAME', 'TAX_REGISTRATION',
                   'CREDIT_LIMIT', 'STATUS', 'MERGE')),
  target_table  text,                       -- child table for an update (e.g. client_bank_account)
  target_id     uuid,                       -- child row id for an update; null for create / merge
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- proposed values, or {survivor_id, loser_id}
  status        text NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'APPLIED', 'REJECTED', 'CANCELLED')),
  reason        text,                       -- why the change / the merge
  requested_by  uuid REFERENCES app_user(user_id),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES app_user(user_id),
  decided_at    timestamptz,
  applied_ref   text,                       -- the created/updated entity_ref once applied
  approval_task_ref text,                   -- the approval_task entity_ref opened for visibility
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_party_change_request_party
  ON party_change_request (party_kind, party_id, status);
CREATE INDEX IF NOT EXISTS ix_party_change_request_status
  ON party_change_request (status, requested_at);

-- Keep the survivor lookup cheap for the 360 "this record's aliases" panel and
-- the merge FK-reattachment path.
CREATE INDEX IF NOT EXISTS ix_client_master_merged_into   ON client_master (merged_into_id);
CREATE INDEX IF NOT EXISTS ix_supplier_master_merged_into ON supplier_master (merged_into_id);

-- DOWN
-- Additive; reverse by dropping the two tables, the two columns and their
-- indexes (commented so nothing runs them by accident). The pg_trgm extension
-- (0514) is left in place — other features rely on it.
-- DROP INDEX IF EXISTS ix_client_master_merged_into;
-- DROP INDEX IF EXISTS ix_supplier_master_merged_into;
-- ALTER TABLE client_master   DROP COLUMN IF EXISTS merged_into_id;
-- ALTER TABLE supplier_master DROP COLUMN IF EXISTS merged_into_id;
-- DROP TABLE IF EXISTS party_change_request;
-- DROP TABLE IF EXISTS party_alias;
