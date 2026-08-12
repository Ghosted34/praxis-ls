-- ============================================================================
-- TENANT DB — 0651 Q tickets: a thread, an owner, and a resolution.
--
-- WHAT EXISTED. 0310 created `q_ticket` — dossier, milestone, subject, body,
-- status — and then nothing was ever built on it. No module, no routes, no UI.
-- The kickoff asked for it by name (§11.7): a client sees a milestone on the
-- portal, something looks wrong, and they raise a query **in the system** rather
-- than sending an email that lives in one person's inbox. That is the whole
-- point — "so everything stays in the system".
--
-- WHY A REPLY TABLE. A ticket with one `body` column is a complaint, not a
-- conversation: the client asks, ops answers, the client confirms. Without a
-- thread that exchange happens over email anyway and the ticket becomes a stub
-- that records only that somebody once asked something. `is_from_client`
-- separates the two voices, because the portal must render one side and never
-- expose internal notes.
--
-- INTERNAL NOTES ARE IN THE THREAD, NOT BESIDE IT. `is_internal` marks a reply
-- ops can see and the client cannot — the alternative is a second place to look,
-- which is how half a conversation goes missing.
--
-- ADDITIVE ONLY. Existing q_ticket rows (there are none in practice) keep
-- working; every new column has a default.
-- ============================================================================

ALTER TABLE q_ticket
  ADD COLUMN IF NOT EXISTS milestone_code   text,
  ADD COLUMN IF NOT EXISTS raised_by_email  citext,
  ADD COLUMN IF NOT EXISTS assigned_to      uuid,
  ADD COLUMN IF NOT EXISTS resolved_at      timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by      uuid,
  ADD COLUMN IF NOT EXISTS evidence_vault_id uuid,
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS q_ticket_reply (
  q_ticket_reply_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  q_ticket_id     uuid NOT NULL REFERENCES q_ticket(q_ticket_id) ON DELETE CASCADE,
  body            text NOT NULL,
  -- Which side of the conversation this is. The portal renders client + non-
  -- internal staff replies; everything else is ours.
  is_from_client  boolean NOT NULL DEFAULT false,
  -- An internal note: visible to ops, never rendered on the portal.
  is_internal     boolean NOT NULL DEFAULT false,
  author_user_id  uuid,
  author_label    text,
  evidence_vault_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_q_ticket_reply_ticket
  ON q_ticket_reply (q_ticket_id, created_at);
CREATE INDEX IF NOT EXISTS ix_q_ticket_open
  ON q_ticket (dossier_id) WHERE status <> 'RESOLVED';

-- DOWN
-- DROP TABLE IF EXISTS q_ticket_reply;
-- ALTER TABLE q_ticket DROP COLUMN IF EXISTS milestone_code,
--   DROP COLUMN IF EXISTS raised_by_email, DROP COLUMN IF EXISTS assigned_to,
--   DROP COLUMN IF EXISTS resolved_at, DROP COLUMN IF EXISTS resolved_by,
--   DROP COLUMN IF EXISTS evidence_vault_id, DROP COLUMN IF EXISTS updated_at;
