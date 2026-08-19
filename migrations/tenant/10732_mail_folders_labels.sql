-- ============================================================================
-- TENANT DB — 10732 Folders, and the per-folder cursors that make them correct.
--
-- ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
--
-- Inbound sync has only ever polled INBOX (documented as G-5 in the 2026-08-06
-- mail audit and deferred there). So Spam, Drafts, Archive and Trash are
-- invisible, and — the one that matters most — the Sent folder is not read, which
-- means a message the user sent from their phone never arrives in the workspace
-- at all. PR-0 built the origin stamp that tells such a message apart; this is
-- the migration that lets it actually be fetched.
--
-- ── WHY A CURSOR PER FOLDER, AND NOT ONE PER CONNECTION ─────────────────────
--
-- `email_connection.sync_cursor` holds one `{uidvalidity, last_uid}`. UIDVALIDITY
-- is a PER-MAILBOX value in IMAP (RFC 3501 §2.3.1.1): when a server renumbers one
-- folder it bumps that folder's UIDVALIDITY, and the correct response is to
-- re-scan that folder. With a shared cursor, a renumber on Spam looks identical
-- to a renumber on Inbox, and the engine re-scans everything — or, worse, treats
-- Inbox's last_uid as meaningful in Spam and silently skips real mail.
--
-- This is the correctness heart of multi-folder sync, which is why the column
-- lives here rather than being squeezed onto the connection as a jsonb map.
--
-- ── SIX CANONICAL FOLDERS, PLUS WHATEVER ELSE THE SERVER HAS ────────────────
--
-- `canonical` is the product's vocabulary; `provider_path` is the server's. The
-- mapping is resolved once, at discovery, preferring the RFC 6154 special-use
-- flags the server advertises over guessing from names — a mailbox called
-- "Éléments envoyés" is Sent, and a name list will never be complete enough.
-- Folders with no canonical mapping are still recorded (so the UI can show them
-- and a later feature can sync them) but are not syncable by default: pulling a
-- 400-folder archive tree on first connect is how a first sync becomes an
-- overnight job nobody asked for.
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_folder (
  email_folder_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_connection_id uuid NOT NULL REFERENCES email_connection(email_connection_id) ON DELETE CASCADE,
  canonical           text CHECK (canonical IS NULL OR canonical IN
                        ('INBOX','SENT','DRAFTS','SPAM','ARCHIVE','TRASH')),
  provider_path       text NOT NULL,
  display_name        text,
  is_syncable         boolean NOT NULL DEFAULT false,
  -- {uidvalidity, last_uid} for IMAP; {delta_link} / {history_id} for the OAuth
  -- adapters. Per FOLDER, never shared — see the header.
  sync_cursor         jsonb,
  last_sync_at        timestamptz,
  last_error          text,
  message_count       integer NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email_connection_id, provider_path)
);

-- One folder per canonical role per mailbox. A server advertising two \Sent
-- folders is a configuration mistake, and letting both claim the role would make
-- "where do sent messages go" depend on scan order.
CREATE UNIQUE INDEX IF NOT EXISTS ux_email_folder_canonical
  ON email_folder (email_connection_id, canonical) WHERE canonical IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_email_folder_syncable
  ON email_folder (email_connection_id) WHERE is_syncable;

/* ── Labels ───────────────────────────────────────────────────────────────── */
-- Personal, not shared: a label is how ONE person organises their view. Making
-- them tenant-wide turns every user's filing into everyone's clutter.
CREATE TABLE IF NOT EXISTS email_label (
  email_label_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  colour         text,
  owner_user_id  uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, name)
);

CREATE TABLE IF NOT EXISTS email_thread_label (
  email_thread_id uuid NOT NULL REFERENCES email_thread(email_thread_id) ON DELETE CASCADE,
  email_label_id  uuid NOT NULL REFERENCES email_label(email_label_id) ON DELETE CASCADE,
  applied_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email_thread_id, email_label_id)
);
CREATE INDEX IF NOT EXISTS ix_email_thread_label_label
  ON email_thread_label (email_label_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_email_folder_updated') THEN
    CREATE TRIGGER trg_email_folder_updated BEFORE UPDATE ON email_folder
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Seed INBOX for every connected mailbox, carrying its existing cursor across so
-- the first sync after this migration resumes where the old one stopped instead
-- of re-fetching the whole inbox.
INSERT INTO email_folder (email_connection_id, canonical, provider_path, display_name, is_syncable, sync_cursor, last_sync_at)
SELECT c.email_connection_id, 'INBOX', 'INBOX', 'Inbox', true, c.sync_cursor, c.last_sync_at
  FROM email_connection c
 WHERE c.status <> 'ARCHIVED'
ON CONFLICT (email_connection_id, provider_path) DO NOTHING;

COMMENT ON COLUMN email_folder.sync_cursor IS
  'Per-folder sync position. UIDVALIDITY is a per-mailbox value in IMAP, so one cursor shared across folders makes a renumber in Spam look like a renumber in Inbox. This column is the correctness heart of multi-folder sync.';
COMMENT ON COLUMN email_folder.is_syncable IS
  'Only the canonical six by default. A server can advertise hundreds of folders and pulling them all on first connect turns a two-minute setup into an overnight job.';

-- DOWN
--   DROP INDEX IF EXISTS ix_email_thread_label_label;
--   DROP INDEX IF EXISTS ix_email_folder_syncable;
--   DROP INDEX IF EXISTS ux_email_folder_canonical;
--   DROP TRIGGER IF EXISTS trg_email_folder_updated ON email_folder;
--   -- DESTRUCTIVE: drops every per-folder cursor, so the next sync re-scans each
--   -- folder from scratch (slow, but not lossy — the dedup index absorbs it), and
--   -- drops every user's labels, which cannot be reconstructed.
--   DROP TABLE IF EXISTS email_thread_label;
--   DROP TABLE IF EXISTS email_label;
--   DROP TABLE IF EXISTS email_folder;
