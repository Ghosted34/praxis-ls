-- ============================================================================
-- TENANT DB — 10723 Mailbox foundation: what a mailbox IS.
--
-- `email_connection` (0483) was built for one shape: a person connects their own
-- mailbox. `owner_user_id` + a partial unique index on `is_default` (0522) let
-- one person own any number of them, one of which is "default". Nothing says
-- whether a mailbox is a person's or a team's, which company it belongs to, or
-- who besides the owner may touch it.
--
-- The Smart Mail programme needs all three, so this migration gives a connection
-- an explicit KIND, an owning ENTITY and a VISIBILITY, and enforces the rule the
-- product is built on: ONE personal mailbox per user, in the database, not in a
-- service that a direct write can bypass.
--
-- ── THE THREE KINDS ─────────────────────────────────────────────────────────
--
--   PERSONAL   the user's own professional address. Exactly one per user.
--   SHARED     a team address (operations@, billing@) with named members.
--   DELEGATED  someone works another user's mailbox on their behalf. Declared
--              here so the later work is behaviour, not another migration.
--
-- ── WHY ARCHIVED IS A STATUS AND NOT A DELETE ───────────────────────────────
--
-- A person leaves. Their correspondence is the company's, and the compliance
-- archive later in the programme has to be able to reach it. So offboarding
-- stops the sync and hides the mailbox from the workspace; it never removes the
-- mail. That is also why the one-personal-mailbox index excludes ARCHIVED rows:
-- a successor must be able to connect their own mailbox at the same address
-- without first destroying the predecessor's.
--
-- ── HOW EXISTING DATA IS MADE TO FIT, WITHOUT LOSING ANY ────────────────────
--
-- A tenant may already have a user owning several connections; the new index
-- would reject them. Rather than pick one and archive the rest — which would
-- silently take a working mailbox away — the backfill keeps the user's DEFAULT
-- connection (or, with no default, the oldest) as PERSONAL and reclassifies the
-- others as SHARED, PRIVATE, with the original owner recorded as their MANAGER
-- in 10725. Access is therefore unchanged: still exactly one person can see
-- them. An admin reclassifies from the UI if the guess was wrong.
-- ============================================================================

ALTER TABLE email_connection
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'PERSONAL',
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'PRIVATE',
  ADD COLUMN IF NOT EXISTS entity_id uuid,
  ADD COLUMN IF NOT EXISTS catalogue_key text,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_success_at timestamptz;

-- corporate_entity is created in 0300; guard the FK so this file also applies to
-- a database provisioned before that (provision order is alphabetical by number,
-- so in practice it is always there — the guard is for partial-run recovery).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = current_schema() AND table_name = 'corporate_entity')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_connection_entity_fk') THEN
    ALTER TABLE email_connection
      ADD CONSTRAINT email_connection_entity_fk
      FOREIGN KEY (entity_id) REFERENCES corporate_entity(entity_id);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE email_connection DROP CONSTRAINT IF EXISTS chk_email_connection_kind;
  ALTER TABLE email_connection ADD CONSTRAINT chk_email_connection_kind
    CHECK (kind IN ('PERSONAL','SHARED','DELEGATED'));
  ALTER TABLE email_connection DROP CONSTRAINT IF EXISTS chk_email_connection_visibility;
  ALTER TABLE email_connection ADD CONSTRAINT chk_email_connection_visibility
    CHECK (visibility IN ('PRIVATE','TEAM','COMPANY'));
END $$;

-- ARCHIVED joins the status vocabulary. The existing four are unchanged.
DO $$ BEGIN
  ALTER TABLE email_connection DROP CONSTRAINT IF EXISTS email_connection_status_check;
  ALTER TABLE email_connection ADD CONSTRAINT email_connection_status_check
    CHECK (status IN ('PENDING','CONNECTED','ERROR','DISABLED','ARCHIVED'));
END $$;

-- A SHARED mailbox must say which catalogue entry it fulfils, or be free-form
-- (NULL). A PERSONAL one must not claim a catalogue slot.
DO $$ BEGIN
  ALTER TABLE email_connection DROP CONSTRAINT IF EXISTS chk_email_connection_catalogue_kind;
  ALTER TABLE email_connection ADD CONSTRAINT chk_email_connection_catalogue_kind
    CHECK (catalogue_key IS NULL OR kind = 'SHARED');
END $$;

-- ── Backfill: make today's rows fit before the constraint lands ─────────────
-- Keep one PERSONAL per owner (the default, else the oldest); everything else
-- that owner holds becomes a PRIVATE SHARED mailbox. 10725 grants them MANAGER
-- on it, so nobody loses access to a mailbox they are using right now.
WITH ranked AS (
  SELECT email_connection_id, owner_user_id,
         row_number() OVER (PARTITION BY owner_user_id
                            ORDER BY is_default DESC, created_at ASC, email_connection_id ASC) AS rn
    FROM email_connection
   WHERE owner_user_id IS NOT NULL
     AND kind = 'PERSONAL'
     AND status <> 'ARCHIVED'
)
UPDATE email_connection c
   SET kind = 'SHARED', visibility = 'PRIVATE'
  FROM ranked r
 WHERE c.email_connection_id = r.email_connection_id
   AND r.rn > 1;

-- THE RULE: one live personal mailbox per user (Q1). In the database, because a
-- rule enforced only in a service is a convention.
CREATE UNIQUE INDEX IF NOT EXISTS ux_email_connection_one_personal
  ON email_connection (owner_user_id)
  WHERE kind = 'PERSONAL' AND status <> 'ARCHIVED' AND owner_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_email_connection_kind
  ON email_connection (kind) WHERE status <> 'ARCHIVED';
CREATE INDEX IF NOT EXISTS ix_email_connection_catalogue
  ON email_connection (catalogue_key) WHERE catalogue_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_email_connection_entity
  ON email_connection (entity_id) WHERE entity_id IS NOT NULL;

COMMENT ON COLUMN email_connection.kind IS
  'PERSONAL (one per user, enforced by ux_email_connection_one_personal) | SHARED (team address with members) | DELEGATED (worked on another user''s behalf).';
COMMENT ON COLUMN email_connection.visibility IS
  'Who may read this mailbox''s threads. PRIVATE = owner and named members only; TEAM = members; COMPANY = anyone with MOD-72 view. Personal defaults PRIVATE, shared defaults TEAM.';
COMMENT ON COLUMN email_connection.archived_at IS
  'Set when a mailbox is retired (usually offboarding). Sync stops and it leaves the workspace; the mail itself is never deleted.';

-- DOWN
--   DROP INDEX IF EXISTS ix_email_connection_entity;
--   DROP INDEX IF EXISTS ix_email_connection_catalogue;
--   DROP INDEX IF EXISTS ix_email_connection_kind;
--   DROP INDEX IF EXISTS ux_email_connection_one_personal;
--   ALTER TABLE email_connection DROP CONSTRAINT IF EXISTS chk_email_connection_catalogue_kind;
--   ALTER TABLE email_connection DROP CONSTRAINT IF EXISTS chk_email_connection_visibility;
--   ALTER TABLE email_connection DROP CONSTRAINT IF EXISTS chk_email_connection_kind;
--   ALTER TABLE email_connection DROP CONSTRAINT IF EXISTS email_connection_entity_fk;
--   ALTER TABLE email_connection DROP CONSTRAINT IF EXISTS email_connection_status_check;
--   ALTER TABLE email_connection ADD CONSTRAINT email_connection_status_check
--     CHECK (status IN ('PENDING','CONNECTED','ERROR','DISABLED'));
--   -- DESTRUCTIVE: drops the kind/visibility/entity classification. The backfill
--   -- above is NOT undone — a connection reclassified from PERSONAL to SHARED
--   -- stays reclassified, because the original ordering is not recoverable once
--   -- the column is gone. Restore from the pre-migration dump if that matters.
--   ALTER TABLE email_connection
--     DROP COLUMN IF EXISTS last_success_at,
--     DROP COLUMN IF EXISTS consecutive_failures,
--     DROP COLUMN IF EXISTS archived_at,
--     DROP COLUMN IF EXISTS department,
--     DROP COLUMN IF EXISTS catalogue_key,
--     DROP COLUMN IF EXISTS entity_id,
--     DROP COLUMN IF EXISTS visibility,
--     DROP COLUMN IF EXISTS kind;
