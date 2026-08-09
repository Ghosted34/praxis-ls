-- ============================================================================
-- TENANT DB — 0631 Financial Dictionary: spend, cost evolution & proof
-- obligations (MOD-05, PR2). Builds on 0630.
--
-- 0630 gave a dictionary item its identity, its OHADA fate and its service
-- tiers. This migration is about what happens to it AFTERWARDS: what it cost
-- over a period, how its rate moved, and whether the proof it demands actually
-- arrived.
--
-- WHAT THIS DOES — and, as importantly, what it does NOT.
--
-- 1. NO new spend table. "Estimated / Committed / Actual over a period" is read
--    from the documents that already carry it — costing_line, purchase_order_item,
--    cash_request_line and cost_entry — and every one of those already has an
--    index on dictionary_item_id (0500_fk_indexes). A materialised spend table
--    would be a second copy of the truth that drifts the first time someone
--    edits a costing without going through the aggregator. The read is a
--    grouped query; the only thing missing was a date index, added below.
--
-- 2. cost_entry gets a posting-date index. The Actual lens dates a cost by its
--    journal_entry.entry_date (the REAL posting date) and only falls back to
--    cost_entry.created_at when the entry is missing — so both sides of that
--    COALESCE need to be indexable.
--
-- 3. expense_rate gets (dictionary_item_id, effective_from DESC). The cost
--    evolution timeline reads the effective-dated history per item + provider,
--    and ix_exprate_item (0200) only covers the item.
--
-- 4. compliance_flag gains the dimensions an ADVISORY flag needs, and which the
--    batch checker never had:
--      - dictionary_item_id  which catalogue line demanded the proof
--      - subject_user_id     WHO owes the document (the requester)
--      - source              'CHECKER' (the batch scan) | 'INLINE' (raised at
--                            the moment the document was written)
--    These three columns are the seam. A future Compliance module groups open
--    flags by dictionary_item_id; an Employee-360 "supporting documents owed"
--    tab is `WHERE subject_user_id = :employee AND resolved_at IS NULL`. Neither
--    needs a new table, and neither needs the flag engine changed again.
--
--    They are NULLable on purpose: every existing flag (and every rule that is
--    not about a dictionary line) legitimately has no item and no subject.
--
-- 5. An open-flag index on entity_ref. The inline raise is idempotent — it
--    checks for an existing OPEN flag on the same (rule_key, entity_ref) before
--    inserting, because a cash request can be saved five times and must not
--    accumulate five identical warnings. That check is a lookup by entity_ref,
--    which had no index (ix_flag_open covers rule_key only).
--
--    NOT a UNIQUE index: this database already contains flags raised by the
--    batch checker, and a unique constraint that fails to build on one tenant's
--    existing duplicates would stop the migration mid-estate. Idempotency is
--    enforced in the repo, where it can be honest about losing a race.
-- ============================================================================

-- ── 1. Spend read paths ─────────────────────────────────────────────────────
-- The Actual lens joins cost_entry → journal_entry for the posting date; the
-- fallback orders by cost_entry.created_at. 0496 indexed created_at on a list of
-- tables that included cost_entry, so only the composite is new here: filtering
-- by item and then bounding by date is the shape every spend query has.
CREATE INDEX IF NOT EXISTS ix_cost_entry_item_created  ON cost_entry(dictionary_item_id, created_at);
CREATE INDEX IF NOT EXISTS ix_journal_entry_date       ON journal_entry(entry_date);

-- ── 2. Cost evolution: effective-dated rate history per item ────────────────
CREATE INDEX IF NOT EXISTS ix_exprate_item_effective   ON expense_rate(dictionary_item_id, effective_from DESC);

-- ── 3. compliance_flag — the advisory dimensions ────────────────────────────
ALTER TABLE compliance_flag
  ADD COLUMN IF NOT EXISTS dictionary_item_id uuid REFERENCES dictionary_item(dictionary_item_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subject_user_id    uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS source             text NOT NULL DEFAULT 'CHECKER';

-- ADD CONSTRAINT has no native IF NOT EXISTS; the DO block is the idempotency
-- guard the migrator requires (it checks pg_constraint before adding).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_flag_source') THEN
    ALTER TABLE compliance_flag ADD CONSTRAINT chk_flag_source CHECK (source IN ('CHECKER','INLINE'));
  END IF;
END $$;

-- The inline raise's "is one already open?" lookup, and the two 360 reads the
-- seam exists for. Partial on resolved_at IS NULL: a closed flag is history, and
-- nothing queries it by these keys.
CREATE INDEX IF NOT EXISTS ix_flag_entity_open  ON compliance_flag(entity_ref)        WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_flag_item_open    ON compliance_flag(dictionary_item_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_flag_subject_open ON compliance_flag(subject_user_id)    WHERE resolved_at IS NULL;

-- DOWN
-- Purely additive: three indexes on existing read paths, one composite on
-- expense_rate, and three NULLable columns + one CHECK on compliance_flag. No
-- existing row is rewritten and no column is narrowed, so undoing this destroys
-- only the advisory dimensions themselves (which nothing outside MOD-05 PR2
-- writes). Drop in reverse dependency order:
--
--   DROP INDEX IF EXISTS ix_flag_subject_open;
--   DROP INDEX IF EXISTS ix_flag_item_open;
--   DROP INDEX IF EXISTS ix_flag_entity_open;
--   ALTER TABLE compliance_flag DROP CONSTRAINT IF EXISTS chk_flag_source;
--   -- DESTRUCTIVE: drops the advisory dimensions; any open proof-obligation
--   -- flag loses which item demanded the proof and who owes it. The flag row
--   -- itself survives (rule_key + entity_ref + message are untouched), so the
--   -- warning is still readable — only the 360 joins are lost.
--   ALTER TABLE compliance_flag
--     DROP COLUMN IF EXISTS source,
--     DROP COLUMN IF EXISTS subject_user_id,
--     DROP COLUMN IF EXISTS dictionary_item_id;
--   DROP INDEX IF EXISTS ix_exprate_item_effective;
--   DROP INDEX IF EXISTS ix_journal_entry_date;
--   DROP INDEX IF EXISTS ix_cost_entry_item_created;
