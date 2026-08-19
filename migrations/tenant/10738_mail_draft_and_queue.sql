-- ============================================================================
-- TENANT DB — 10738 Drafts, and the send queue that makes undo-send possible.
--
-- ── WHY SENDING IS A QUEUE AND NOT A FUNCTION CALL ──────────────────────────
--
-- `POST /mail/send` never talks to SMTP inline. It writes a row here with
-- `status='HELD'` and a `release_at` a few seconds out, and returns. A worker
-- picks it up when it comes due.
--
-- That buys three things a synchronous send cannot:
--
--   1. UNDO. The twenty seconds between pressing Send and the message leaving is
--      the single most-wanted feature in every mail client, and it exists only
--      because the send has not happened yet. Cancelling is one
--      `UPDATE ... WHERE status='HELD'` and a rowcount check — so the race
--      against the worker is decided by the DATABASE, not by a timer in a
--      browser that may be closed, asleep, or on a different device.
--   2. THE REQUEST STOPS WAITING ON A THIRD PARTY. A cPanel SMTP handshake can
--      take fifteen seconds on a bad day. Holding an HTTP request open for that
--      makes the compose window feel broken and ties up a worker per send.
--   3. RETRIES THAT SURVIVE A RESTART. `attempts` and `last_error` are on the
--      row, so a transient 4xx from the mail host is retried with backoff rather
--      than lost with the process that was holding it.
--
-- ── THE STATUS LADDER IS ONE-WAY, AND `SENDING` IS THE LOCK ─────────────────
--
--   HELD ──► QUEUED ──► SENDING ──► SENT
--     │                    │
--     └──► CANCELLED       └──► FAILED (after `attempts` exhausted)
--
-- A row is claimed by flipping it to `SENDING` inside `FOR UPDATE SKIP LOCKED`,
-- which is what lets several workers drain the queue without two of them sending
-- the same message. Nothing moves out of `SENT` or `CANCELLED`.
--
-- ── ONE LIVE DRAFT PER USER PER REPLY TARGET ────────────────────────────────
--
-- Autosave writes constantly, and without a uniqueness rule every keystroke
-- burst that raced itself would leave a second draft behind. The user then opens
-- the thread tomorrow, sees one of the two, and loses the other's text with no
-- way to know it existed. The partial unique index makes the upsert the only
-- possible outcome. `NEW` drafts have no reply target, so they are excluded —
-- a person may legitimately have several unsent new messages open.
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_draft (
  email_draft_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  email_connection_id uuid REFERENCES email_connection(email_connection_id) ON DELETE CASCADE,
  -- The conversation this will join. Carried separately from the message so a
  -- reply still threads correctly if the specific message is later purged.
  email_thread_id     uuid REFERENCES email_thread(email_thread_id) ON DELETE SET NULL,
  reply_to_message_id uuid REFERENCES email_message(email_message_id) ON DELETE SET NULL,
  kind                text NOT NULL DEFAULT 'NEW'
                        CHECK (kind IN ('NEW', 'REPLY', 'REPLY_ALL', 'FORWARD')),
  to_address          citext[] NOT NULL DEFAULT '{}',
  cc_address          citext[] NOT NULL DEFAULT '{}',
  bcc_address         citext[] NOT NULL DEFAULT '{}',
  subject             text,
  -- The TipTap document. This is the EDITABLE truth: reopening a draft restores
  -- from here, never from the HTML, because HTML→editor is lossy and would
  -- quietly degrade a message every time someone came back to it.
  body_json           jsonb,
  -- What would actually be sent, produced by the SERVER's serializer. Stored so
  -- the preview and the sent message cannot disagree.
  body_html           text,
  body_text           text,
  send_point_key      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_email_draft_one_per_reply
  ON email_draft (user_id, reply_to_message_id, kind)
  WHERE reply_to_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_email_draft_user ON email_draft (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_email_draft_thread ON email_draft (email_thread_id)
  WHERE email_thread_id IS NOT NULL;

-- Now that the table exists, the attachment FK 10737 declared can be enforced.
-- ON DELETE CASCADE: discarding a draft takes its staged attachments with it.
-- The vault bytes are reaped separately — a row here is a reference, not the file.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                  WHERE constraint_schema = current_schema()
                    AND constraint_name = 'email_attachment_draft_fk') THEN
    ALTER TABLE email_attachment
      ADD CONSTRAINT email_attachment_draft_fk
      FOREIGN KEY (email_draft_id) REFERENCES email_draft(email_draft_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS email_send_queue (
  email_send_queue_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_connection_id uuid NOT NULL REFERENCES email_connection(email_connection_id) ON DELETE CASCADE,
  user_id             uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  email_draft_id      uuid REFERENCES email_draft(email_draft_id) ON DELETE SET NULL,
  email_thread_id     uuid REFERENCES email_thread(email_thread_id) ON DELETE SET NULL,
  -- The fully composed message: recipients, subject, both body parts, the
  -- resolved attachment ids and the origin headers. Frozen at enqueue time on
  -- purpose — what leaves must be what the sender saw and approved, not what a
  -- later edit to the draft or the signature would have produced.
  payload             jsonb NOT NULL,
  status              text NOT NULL DEFAULT 'HELD'
                        CHECK (status IN ('HELD', 'QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED')),
  -- now() + the undo window, or a scheduled time once PR-5 lands.
  release_at          timestamptz NOT NULL DEFAULT now(),
  attempts            integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error          text,
  error_code          text,
  sent_message_id     uuid REFERENCES email_message(email_message_id) ON DELETE SET NULL,
  -- The client's replay key. An offline compose that is POSTed twice on
  -- reconnect must enqueue once; the HTTP idempotency layer covers the retry it
  -- can see, and this covers the one it cannot.
  idempotency_key     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz
);

-- The flusher's only query: due rows, oldest first. Partial, because SENT and
-- CANCELLED rows accumulate forever and must not be walked on every tick.
CREATE INDEX IF NOT EXISTS ix_email_send_queue_due
  ON email_send_queue (release_at)
  WHERE status IN ('HELD', 'QUEUED');
CREATE INDEX IF NOT EXISTS ix_email_send_queue_user
  ON email_send_queue (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_email_send_queue_idempotency
  ON email_send_queue (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON TABLE email_send_queue IS
  'Outbound staging. POST /mail/send writes HELD here and returns; a worker sends it when release_at passes. The gap is what makes undo-send possible, and cancelling is an UPDATE ... WHERE status=''HELD'' so the race against the worker is decided by the database.';
COMMENT ON COLUMN email_send_queue.payload IS
  'The composed message, frozen at enqueue time. What leaves must be what the sender approved, not what a later edit to the draft would have produced.';
COMMENT ON COLUMN email_draft.body_json IS
  'The TipTap document — the editable truth. Reopening restores from here, never from body_html: HTML back into the editor is lossy and would degrade the message a little every time someone came back to it.';

-- DOWN
--   -- DESTRUCTIVE: drops every unsent draft and every queued-but-unsent message.
--   -- A row in HELD or QUEUED has been composed by a person and not yet left the
--   -- building; dropping the table loses it with no trace. Drain the queue first.
--   DROP TABLE IF EXISTS email_send_queue;
--   ALTER TABLE email_attachment DROP CONSTRAINT IF EXISTS email_attachment_draft_fk;
--   DROP TABLE IF EXISTS email_draft;
