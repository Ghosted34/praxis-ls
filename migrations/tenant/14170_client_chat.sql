-- ============================================================================
-- TENANT DB — 14170 The client chat: a thread per shipment and a General one,
-- with photos, files, voice notes and location pins (client portal redesign,
-- PR 2).
--
-- `client_message` (10707) already carries the conversation, and `dossier_id`
-- already says which shipment a message is about — a NULL is the General
-- thread. What it could not carry was anything but text, what stage of the
-- shipment a message is about, or whether anyone had read it. This adds those,
-- without moving a single existing row.
--
-- ── ATTACHMENTS ARE A TABLE, NOT COLUMNS ────────────────────────────────────
--
-- One file per message today (a phone sends a burst of photos as a burst of
-- messages, the way every messaging app does), but a table costs nothing more
-- than columns and keeps the door open. The bytes live in the vault like every
-- other file a client sends — `doc_id` — so a photo of a damaged container is
-- evidence with a content hash, not a chat artefact. `width`/`height` let the
-- bubble reserve its space before the image arrives (no jump while scrolling);
-- `duration_ms` is the voice note's length, shown before it is played.
--
-- ── WHY THE BODY CHECK GOES ─────────────────────────────────────────────────
--
-- 10707 required 1-4000 characters of text. A photo, a voice note or a pin can
-- stand alone, so the text becomes optional — and, as 13791 requires of an
-- EXISTING table (tests/unit/migration-constraint-ordering.test.js), the rule
-- that replaces the CHECK is enforced where the row is written: the validator
-- bounds the text at 4000 characters, and the chat service refuses a message
-- with no text, no attachment and no location (EMPTY_MESSAGE). Dropping a
-- constraint is not what 13791 guards against; adding one is.
--
-- ── PLAIN COLUMNS ON client_message, FOR THE SAME REASON ────────────────────
--
--   milestone_instance_id  the stage a message is about. No foreign key (an
--                          existing table gains plain columns only); the
--                          service checks it belongs to the message's shipment
--                          and is client-visible (MILESTONE_MISMATCH).
--   location_*             a pin: where the truck is, where to deliver. The
--                          validator bounds latitude to ±90 and longitude to
--                          ±180 — here they are plain numerics.
--   portal_user_id         which of the client's colleagues wrote it. Identity
--                          lives in the live schema while this row can be in
--                          sandbox, so it is not a foreign key either (the
--                          same reason vault uploads resolve `uploaded_by`).
--   staff_read_at          when the team first read a client message — the
--                          client's "seen" tick, and the unread count of the
--                          staff inbox (PR 3).
--
-- ── READ CURSORS ────────────────────────────────────────────────────────────
--
-- Unread counts for the client are per PERSON and per THREAD: Marie reading
-- the General thread on her phone does not mark it read for her colleague, nor
-- mark the shipment threads read for herself. A cursor is the timestamp up to
-- which a person has read a thread; anything newer from the team is unread.
-- `thread_key` is 'general' or the dossier id as text.
-- ============================================================================

CREATE TABLE IF NOT EXISTS client_message_attachment (
  attachment_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     uuid NOT NULL REFERENCES client_message(message_id) ON DELETE CASCADE,
  doc_id         uuid NOT NULL REFERENCES document_vault(doc_id),
  kind           text NOT NULL,
  file_name      text,
  mime_type      text,
  byte_size      integer,
  width          integer,
  height         integer,
  duration_ms    integer,
  position       integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_client_message_attachment_kind CHECK (kind IN ('IMAGE','FILE','VOICE')),
  CONSTRAINT ck_client_message_attachment_duration CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 600000)
);
CREATE INDEX IF NOT EXISTS ix_client_message_attachment_message ON client_message_attachment (message_id);
CREATE INDEX IF NOT EXISTS ix_client_message_attachment_doc ON client_message_attachment (doc_id);

ALTER TABLE client_message ADD COLUMN IF NOT EXISTS milestone_instance_id uuid;
ALTER TABLE client_message ADD COLUMN IF NOT EXISTS location_lat numeric(9,6);
ALTER TABLE client_message ADD COLUMN IF NOT EXISTS location_lng numeric(9,6);
ALTER TABLE client_message ADD COLUMN IF NOT EXISTS location_label text;
ALTER TABLE client_message ADD COLUMN IF NOT EXISTS portal_user_id uuid;
ALTER TABLE client_message ADD COLUMN IF NOT EXISTS staff_read_at timestamptz;

-- A photo, a voice note or a pin can stand alone (see the header).
ALTER TABLE client_message DROP CONSTRAINT IF EXISTS client_message_body_check;

-- The threads list and the per-thread page both read "this client, this
-- thread, newest first"; General is the NULL dossier.
CREATE INDEX IF NOT EXISTS ix_client_message_thread ON client_message (client_id, dossier_id, created_at DESC);
-- The staff inbox's "waiting for us" read (PR 3) and the client's seen ticks.
CREATE INDEX IF NOT EXISTS ix_client_message_unread_staff
  ON client_message (client_id, created_at) WHERE direction = 'CLIENT' AND staff_read_at IS NULL;

CREATE TABLE IF NOT EXISTS client_message_cursor (
  client_id       uuid NOT NULL REFERENCES client_master(client_id) ON DELETE CASCADE,
  portal_user_id  uuid NOT NULL,
  thread_key      text NOT NULL,
  last_read_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_client_message_cursor PRIMARY KEY (client_id, portal_user_id, thread_key),
  CONSTRAINT ck_client_message_cursor_thread CHECK (thread_key = 'general' OR thread_key ~ '^[0-9a-f-]{36}$')
);

-- DOWN
-- Additive, apart from the CHECK: restoring it would fail on every message that
-- is only a photo, a voice note or a pin, so those must be given text first.
--
--   DROP TABLE IF EXISTS client_message_cursor;
--   -- DESTRUCTIVE: the chat's photos, files and voice notes lose their link to
--   -- their messages (the documents themselves stay in the vault).
--   DROP TABLE IF EXISTS client_message_attachment;
--   DROP INDEX IF EXISTS ix_client_message_unread_staff;
--   DROP INDEX IF EXISTS ix_client_message_thread;
--   ALTER TABLE client_message
--     DROP COLUMN IF EXISTS staff_read_at,
--     DROP COLUMN IF EXISTS portal_user_id,
--     DROP COLUMN IF EXISTS location_label,
--     DROP COLUMN IF EXISTS location_lng,
--     DROP COLUMN IF EXISTS location_lat,
--     DROP COLUMN IF EXISTS milestone_instance_id;
--   UPDATE client_message SET body = '[attachment]' WHERE length(btrim(body)) = 0;
--   ALTER TABLE client_message ADD CONSTRAINT client_message_body_check
--     CHECK (length(btrim(body)) BETWEEN 1 AND 4000);
