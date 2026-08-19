-- ============================================================================
-- TENANT DB — 10731 The message model: threads, messages, and per-user state.
--
-- ── WHAT WAS THERE ──────────────────────────────────────────────────────────
--
-- One table, `email_inbound` (0451, enriched by 0484), holding BOTH directions
-- with a single `is_read` boolean and no thread entity. It has carried the mail
-- engine well enough while mail was one person reading their own inbox. It
-- cannot carry what comes next, for three reasons that are all the same reason:
-- the table has no room for anything to be true of a message FOR SOMEBODY.
--
--   1. A shared mailbox needs "read by Marie, unread by Paul". One boolean
--      cannot say that, and no amount of care in the service layer invents the
--      row it would need.
--   2. A conversation has properties a message does not — a participant set, an
--      assignee, an SLA clock, a binding to a dossier. Hanging those off every
--      message means updating N rows to say one thing, and reading N rows to
--      ask one question.
--   3. Folders, labels, snoozing and stars are per-user or per-thread, not
--      per-message-per-everybody.
--
-- ── WHY THERE IS NO COMPATIBILITY VIEW ──────────────────────────────────────
--
-- The plan of record called for renaming the table and putting a VIEW named
-- `email_inbound` in its place, to shield consumers. Building it, three things
-- made that the wrong call and it is deliberately NOT done:
--
--   · A view is not insertable. All three writers (`insertInbound`,
--     `markInboundRead`, `setEntityRef`) would break anyway, so the view shields
--     nobody who writes — and rewriting the writers is most of the work.
--   · There are no consumers to shield. Every reader is inside src/modules/mail:
--     mail.repo, mail.service, mail.ai, mail.events and the sync worker. Five
--     files, all ours, all rewritten in this change.
--   · The view would have had to collapse per-user read state with
--     `bool_or(is_read)` — "read by anyone means read". That is precisely the
--     semantics this migration exists to remove, left behind as a thing that
--     answers questions wrongly. A second way to compute a value that disagrees
--     with the first is the defect, not the mitigation.
--
-- So the old table is RENAMED to `email_inbound_legacy` and kept, untouched, for
-- one release. Nothing reads it. It is there so a restore is a rename rather
-- than a backup trawl, and a later migration drops it once this has run in
-- production for a cycle.
--
-- ── ON THE BACKFILL ─────────────────────────────────────────────────────────
--
-- Every existing message keeps its id. `email_message_id` is the old
-- `email_inbound_id`, which means `email_attachment` needs no data change (only
-- a re-pointed foreign key), entity_refs already recorded on the AI timeline
-- stay valid, and any id a client happens to be holding still resolves. Grouping
-- is by the thread key the engine already computed, so no thread is invented
-- that the old data did not already imply.
-- ============================================================================

/* ── The conversation ─────────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS email_thread (
  email_thread_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_connection_id uuid NOT NULL REFERENCES email_connection(email_connection_id) ON DELETE CASCADE,
  -- Provider thread id where the provider has one, else References[0], else the
  -- Message-Id. Never the subject: two unrelated "Re: Invoice" messages are two
  -- conversations, and merging them is the classic threading bug.
  thread_key          text NOT NULL,
  subject             text,
  participants        citext[] NOT NULL DEFAULT '{}',
  message_count       integer NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  has_attachment      boolean NOT NULL DEFAULT false,
  -- HUMAN vs SYSTEM is the split inbox (10734). Stored on the thread because a
  -- conversation does not change kind halfway through.
  stream              text NOT NULL DEFAULT 'HUMAN' CHECK (stream IN ('HUMAN','SYSTEM')),
  stream_reason       text,
  is_vip              boolean NOT NULL DEFAULT false,
  -- Set only by an ACCEPTED binding. PR-3 replaces the ingest-time auto-link
  -- with suggestions; until then the sync still writes it, exactly as before.
  entity_ref          text,
  first_message_at    timestamptz NOT NULL DEFAULT now(),
  last_message_at     timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email_connection_id, thread_key)
);

/* ── The message ──────────────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS email_message (
  email_message_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_thread_id     uuid NOT NULL REFERENCES email_thread(email_thread_id) ON DELETE CASCADE,
  email_connection_id uuid NOT NULL REFERENCES email_connection(email_connection_id) ON DELETE CASCADE,
  email_identity_id   uuid REFERENCES email_identity(email_identity_id),
  external_message_id text,
  message_id_header   text,
  direction           text NOT NULL CHECK (direction IN ('IN','OUT')),
  folder              text NOT NULL DEFAULT 'INBOX'
                        CHECK (folder IN ('INBOX','SENT','DRAFTS','SPAM','ARCHIVE','TRASH')),
  -- The provider's own path, kept so a move can be round-tripped and so a
  -- future arbitrary-folder-tree feature is additive rather than a re-model.
  provider_folder     text,
  from_address        citext NOT NULL,
  from_name           text,
  to_address          citext[] NOT NULL DEFAULT '{}',
  cc_address          citext[] NOT NULL DEFAULT '{}',
  bcc_address         citext[] NOT NULL DEFAULT '{}',
  reply_to            citext,
  subject             text,
  body_html           text,
  body_text           text,
  body_preview        text,
  in_reply_to         text,
  references_header   text[],
  size_bytes          bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  language            text,
  has_attachment      boolean NOT NULL DEFAULT false,
  -- Origin tagging carried across from PR-0's 10727. Losing origin_user_id here
  -- would make every shared-mailbox send anonymous retroactively.
  sent_via            text CHECK (sent_via IS NULL OR sent_via IN ('PRAXIS','EXTERNAL','UNKNOWN')),
  origin_user_id      uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  origin_send_point   text,
  received_at         timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_email_message_origin_direction
    CHECK (direction = 'OUT' OR (origin_user_id IS NULL AND origin_send_point IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_email_message_dedup
  ON email_message (email_connection_id, external_message_id)
  WHERE external_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_email_message_thread
  ON email_message (email_thread_id, received_at);
CREATE INDEX IF NOT EXISTS ix_email_message_folder
  ON email_message (email_connection_id, folder, received_at DESC);
CREATE INDEX IF NOT EXISTS ix_email_message_msgid
  ON email_message (message_id_header) WHERE message_id_header IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_email_message_origin_user
  ON email_message (origin_user_id) WHERE origin_user_id IS NOT NULL;

/* ── Per-user state: the whole reason for the rework ─────────────────────── */

CREATE TABLE IF NOT EXISTS email_message_state (
  email_message_id uuid NOT NULL REFERENCES email_message(email_message_id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  is_read          boolean NOT NULL DEFAULT false,
  is_starred       boolean NOT NULL DEFAULT false,
  read_at          timestamptz,
  PRIMARY KEY (email_message_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_email_message_state_unread
  ON email_message_state (user_id) WHERE NOT is_read;

/* ── The list query is the hottest thing in the product ──────────────────── */
-- Covering, so the thread list does not touch the heap for the columns it
-- renders. `stream` is in the key because the Human/System toggle is a filter
-- on every single load, not an occasional one.
CREATE INDEX IF NOT EXISTS ix_email_thread_list
  ON email_thread (email_connection_id, stream, last_message_at DESC)
  INCLUDE (subject, message_count, has_attachment, is_vip, entity_ref);
CREATE INDEX IF NOT EXISTS ix_email_thread_entity
  ON email_thread (entity_ref) WHERE entity_ref IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_email_thread_updated') THEN
    CREATE TRIGGER trg_email_thread_updated BEFORE UPDATE ON email_thread
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

/* ── Backfill ─────────────────────────────────────────────────────────────── */
-- Guarded on the source table still being the live one, so a re-run after the
-- rename below is a clean no-op rather than an error.
DO $$
DECLARE
  legacy_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name = 'email_inbound'
  ) INTO legacy_exists;
  IF NOT legacy_exists THEN RETURN; END IF;

  -- Threads first. The key is what the engine already computed; a message with
  -- none is its own conversation, keyed on its id so it cannot collide.
  INSERT INTO email_thread (
    email_connection_id, thread_key, subject, participants,
    message_count, has_attachment, entity_ref, first_message_at, last_message_at)
  SELECT b.email_connection_id,
         COALESCE(NULLIF(b.thread_key, ''), b.external_message_id, b.email_inbound_id::text),
         (array_agg(b.subject ORDER BY b.received_at))[1],
         ARRAY(SELECT DISTINCT x FROM unnest(
                 array_agg(b.from_address) || array_agg(COALESCE(b.to_address, '')::citext)
               ) AS x WHERE x <> ''),
         count(*)::int,
         bool_or(EXISTS (SELECT 1 FROM email_attachment a WHERE a.email_inbound_id = b.email_inbound_id)),
         (array_agg(b.entity_ref ORDER BY b.received_at DESC) FILTER (WHERE b.entity_ref IS NOT NULL))[1],
         min(b.received_at), max(b.received_at)
    FROM email_inbound b
   WHERE b.email_connection_id IS NOT NULL
   GROUP BY b.email_connection_id,
            COALESCE(NULLIF(b.thread_key, ''), b.external_message_id, b.email_inbound_id::text)
  ON CONFLICT (email_connection_id, thread_key) DO NOTHING;

  -- Messages keep their id, which is what makes the attachment FK a re-point
  -- rather than a data migration.
  INSERT INTO email_message (
    email_message_id, email_thread_id, email_connection_id, email_identity_id,
    external_message_id, message_id_header, direction, folder,
    from_address, to_address, subject, body_html, body_text, body_preview,
    in_reply_to, has_attachment, sent_via, origin_user_id, origin_send_point, received_at)
  SELECT b.email_inbound_id, t.email_thread_id, b.email_connection_id, b.email_identity_id,
         b.external_message_id, b.message_id_header, b.direction,
         CASE WHEN b.direction = 'OUT' THEN 'SENT' ELSE 'INBOX' END,
         b.from_address,
         CASE WHEN COALESCE(b.to_address, '') = '' THEN '{}'::citext[]
              ELSE string_to_array(b.to_address::text, ', ')::citext[] END,
         b.subject, b.body_html, b.body_text, b.body_preview, b.in_reply_to,
         EXISTS (SELECT 1 FROM email_attachment a WHERE a.email_inbound_id = b.email_inbound_id),
         b.sent_via, b.origin_user_id, b.origin_send_point, b.received_at
    FROM email_inbound b
    JOIN email_thread t
      ON t.email_connection_id = b.email_connection_id
     AND t.thread_key = COALESCE(NULLIF(b.thread_key, ''), b.external_message_id, b.email_inbound_id::text)
   WHERE b.email_connection_id IS NOT NULL
  ON CONFLICT (email_message_id) DO NOTHING;

  -- Read state belonged to nobody in particular; it becomes the connection
  -- owner's, which is who it actually described.
  INSERT INTO email_message_state (email_message_id, user_id, is_read, read_at)
  SELECT b.email_inbound_id, c.owner_user_id, b.is_read,
         CASE WHEN b.is_read THEN b.received_at ELSE NULL END
    FROM email_inbound b
    JOIN email_connection c ON c.email_connection_id = b.email_connection_id
   WHERE c.owner_user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM email_message m WHERE m.email_message_id = b.email_inbound_id)
  ON CONFLICT (email_message_id, user_id) DO NOTHING;

  -- Re-point the attachment FK. Ids are identical, so no row moves.
  ALTER TABLE email_attachment DROP CONSTRAINT IF EXISTS email_attachment_email_inbound_id_fkey;
  ALTER TABLE email_attachment
    ADD CONSTRAINT email_attachment_message_fk
    FOREIGN KEY (email_inbound_id) REFERENCES email_message(email_message_id) ON DELETE CASCADE;

  -- Kept, not dropped. Nothing reads it; it is a one-rename restore path for a
  -- release, and a later migration removes it.
  ALTER TABLE email_inbound RENAME TO email_inbound_legacy;
END $$;

COMMENT ON TABLE email_thread IS
  'A conversation. Properties that belong to the exchange rather than to one message — participants, stream, VIP, the ERP binding — live here so asking about them is one row, not N.';
COMMENT ON TABLE email_message_state IS
  'Read and starred, PER USER. The reason the single-table model had to go: a shared mailbox needs "read by Marie, unread by Paul", which one boolean on the message cannot express.';
COMMENT ON TABLE email_inbound_legacy IS
  'The pre-10731 message table, renamed and retained for one release as a restore path. NOTHING reads it. Dropped by a later migration.';

-- DOWN
--   -- The old table was renamed, not dropped, so the down path is a rename back
--   -- and a drop of the new tables. Anything that arrived AFTER this migration
--   -- ran lives only in email_message and is lost — export it first:
--   --   \copy (SELECT * FROM email_message WHERE created_at > '<migration time>') TO 'rescue.csv' CSV HEADER
--   --
--   ALTER TABLE email_attachment DROP CONSTRAINT IF EXISTS email_attachment_message_fk;
--   ALTER TABLE email_inbound_legacy RENAME TO email_inbound;
--   ALTER TABLE email_attachment
--     ADD CONSTRAINT email_attachment_email_inbound_id_fkey
--     FOREIGN KEY (email_inbound_id) REFERENCES email_inbound(email_inbound_id) ON DELETE CASCADE;
--   DROP INDEX IF EXISTS ix_email_thread_entity;
--   DROP INDEX IF EXISTS ix_email_thread_list;
--   DROP INDEX IF EXISTS ix_email_message_state_unread;
--   DROP INDEX IF EXISTS ix_email_message_origin_user;
--   DROP INDEX IF EXISTS ix_email_message_msgid;
--   DROP INDEX IF EXISTS ix_email_message_folder;
--   DROP INDEX IF EXISTS ix_email_message_thread;
--   DROP INDEX IF EXISTS ux_email_message_dedup;
--   -- DESTRUCTIVE: drops every message received after the cut-over, plus all
--   -- per-user read state, folders and thread grouping. See the export above.
--   DROP TABLE IF EXISTS email_message_state;
--   DROP TABLE IF EXISTS email_message;
--   DROP TABLE IF EXISTS email_thread;
