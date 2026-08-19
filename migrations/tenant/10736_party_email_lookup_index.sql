-- ============================================================================
-- TENANT DB — 10736 Case-folded email lookup on the four party tables.
--
-- WHY THIS MIGRATION EXISTS
--
-- Mail ingest asks one question on the first message of every new conversation:
-- "does this sender belong to somebody we know?" (thread.repo.knownParty, and
-- mail.repo.findClientByEmail for the auto-link). The answer decides whether a
-- message is filed as human correspondence or buried in the system stream, so
-- it runs on the hot path of every sync.
--
-- Two problems, one fix:
--
--   1. CORRECTNESS. Those queries used `email = $1`, which is case-SENSITIVE.
--      An address arrives exactly as the sender's mail client wrote it —
--      `Client@Maersk.CM` is an ordinary From line — while the CRM row was typed
--      by whoever created the record. The comparison therefore failed on real
--      mail from real clients, and failed INVISIBLY: the known-party override
--      never fired and the message was classified on its headers alone. The
--      queries now compare `lower(email)`.
--
--   2. COST. There was no index on `email` on any of the four tables, so each
--      lookup was four sequential scans. Wrapping the column in `lower()` would
--      have kept it that way; a FUNCTIONAL index on `lower(email)` makes it an
--      index scan and matches the new predicate exactly.
--
-- These are plain non-unique indexes. Two clients CAN legitimately share a
-- contact address (a group mailbox at a customer, a shared broker inbox), and
-- the ingest query takes the first row by `created_at` rather than assuming
-- uniqueness — so a unique index here would reject data the CRM already allows.
--
-- Indexes are created without CONCURRENTLY on purpose: the migration runner
-- wraps each file in a transaction, and CREATE INDEX CONCURRENTLY cannot run
-- inside one. These four tables are small enough in every deployment that the
-- brief write lock is not worth splitting the migration for.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_client_master_email_lower   ON client_master   (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_master_email_lower ON supplier_master (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employee_email_lower        ON employee        (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_email_lower            ON lead            (lower(email)) WHERE email IS NOT NULL;

-- DOWN
--   DROP INDEX IF EXISTS idx_client_master_email_lower;
--   DROP INDEX IF EXISTS idx_supplier_master_email_lower;
--   DROP INDEX IF EXISTS idx_employee_email_lower;
--   DROP INDEX IF EXISTS idx_lead_email_lower;
