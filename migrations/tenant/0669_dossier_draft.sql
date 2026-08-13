-- ============================================================================
-- TENANT DB — 0669 DRAFT files, and one place that decides what "a file" means.
--
-- WHY A DRAFT STATE AT ALL
--
-- Documents can only be attached to a file that exists: the vault's rows carry
-- `dossier_id`, and the storage key is minted per upload. Legacy had the same
-- constraint and solved it by refusing to upload until after save
-- (`upload.php` requires an existing ref), which is why nobody uploads anything
-- at creation and the documents arrive days later or not at all.
--
-- So the creation wizard opens a DRAFT the moment it has an entity, a client and
-- a service type, and every upload after that is an ordinary upload against an
-- ordinary dossier_id. Promotion at the end flips it to OPEN.
--
-- A DRAFT IS NOT A FILE, AND THAT IS THE WHOLE RISK
--
-- Forty-three queries read `dossier` across nineteen files: lists, the Control
-- Tower, dashboards, KPI counts, the client portal, milestone SLA sweeps, AI
-- knowledge cards, document templates. Every one of them that ENUMERATES rather
-- than fetching a known id would start counting half-finished forms as work in
-- progress — a phantom file in a board report, an SLA percentage computed over
-- records nobody finished typing.
--
-- Auditing those forty-three call sites once would work today and rot on the
-- first new one. So the exclusion is a VIEW, and the rule is inverted: readers
-- select from `dossier_visible`, and a query that genuinely wants drafts has to
-- say so by naming the base table. A reader added next month that forgets is
-- wrong in the safe direction — it sees fewer rows, not phantom ones — and
-- `tests/unit/dossier-draft-isolation.test.js` fails the build when an
-- enumerating query is pointed at the base table.
--
-- WHY THE REF IS ALLOCATED AT PROMOTION
--
-- `ref` is NOT NULL UNIQUE and our format is sequential (`SLAS-2026-0001`).
-- Burning one on every abandoned draft would leave visible gaps in a
-- human-readable series that people reconcile against — legacy's random
-- 7-digit refs hid that, ours would not, and "why does the file after 0042 say
-- 0044" is a question somebody has to answer every time.
--
-- A draft therefore carries a reserved placeholder (`DRAFT-<uuid>`), unique by
-- construction and obviously not a real reference, and gets its real one from
-- the numbering service when it is promoted. The CHECK below makes the two
-- states agree: a DRAFT must hold a placeholder, and anything else must not.
-- ============================================================================

-- ── 1. The status ───────────────────────────────────────────────────────────
-- 0310 declared the CHECK inline, so Postgres auto-named it `dossier_status_check`.
ALTER TABLE dossier DROP CONSTRAINT IF EXISTS dossier_status_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dossier_status_check') THEN
    ALTER TABLE dossier ADD CONSTRAINT dossier_status_check
      CHECK (status IN ('DRAFT','OPEN','IN_PROGRESS','COMPLETED','CANCELLED'));
  END IF;
END $$;

-- When the draft was opened, so the sweeper can find abandoned ones. NULL on
-- every file that never was one, which is every file that exists today.
ALTER TABLE dossier ADD COLUMN IF NOT EXISTS draft_started_at timestamptz;

-- ── 2. Placeholder refs, and the rule that keeps them honest ────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_dossier_draft_ref') THEN
    ALTER TABLE dossier ADD CONSTRAINT chk_dossier_draft_ref CHECK (
      (status = 'DRAFT' AND ref LIKE 'DRAFT-%')
      OR (status <> 'DRAFT' AND ref NOT LIKE 'DRAFT-%')
    );
  END IF;
END $$;

-- Finding the abandoned ones is the sweeper's whole job; it should not scan
-- every file in the tenant to do it.
CREATE INDEX IF NOT EXISTS ix_dossier_draft_started
  ON dossier(draft_started_at) WHERE status = 'DRAFT';

-- ── 3. The view every enumerating reader uses ───────────────────────────────
-- `SELECT *`, deliberately: the view must gain a column the moment `dossier`
-- does, or the next migration that adds one silently breaks every reader that
-- went through here. CREATE OR REPLACE cannot change an existing view's column
-- list, so a column added later needs this file re-run or the view dropped —
-- which is exactly the kind of thing a schema test should catch, and does.
CREATE OR REPLACE VIEW dossier_visible AS
  SELECT * FROM dossier WHERE status <> 'DRAFT';

COMMENT ON VIEW dossier_visible IS
  'Operations files a person should see. Excludes DRAFT — half-finished wizard '
  'state that is not yet a file. Read from here for lists, counts, dashboards, '
  'the portal and anything that enumerates; use the base table only for a '
  'known dossier_id, or when you deliberately want drafts (the wizard, the '
  'sweeper).';

-- DOWN
-- The view and column are additive; the CHECK is not. Narrowing the status list
-- fails while any DRAFT row exists, which is correct — promote or delete them
-- deliberately rather than having a migration decide.
--
--   DROP VIEW IF EXISTS dossier_visible;
--   DROP INDEX IF EXISTS ix_dossier_draft_started;
--   ALTER TABLE dossier DROP CONSTRAINT IF EXISTS chk_dossier_draft_ref;
--   ALTER TABLE dossier DROP COLUMN IF EXISTS draft_started_at;
--   ALTER TABLE dossier DROP CONSTRAINT IF EXISTS dossier_status_check;
--   -- DESTRUCTIVE unless every DRAFT row is gone first.
--   ALTER TABLE dossier ADD CONSTRAINT dossier_status_check
--     CHECK (status IN ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED'));
