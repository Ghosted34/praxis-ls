-- ============================================================================
-- TENANT DB — 10725 Who may work a mailbox, and what they may do with it.
--
-- Reading a team's mail and sending AS that team are different rights. A junior
-- clerk should be able to read billing@ and answer a question about an invoice
-- without being able to put the company's name on an outbound message. One
-- boolean "is a member" cannot express that, so membership carries a role.
--
--   VIEWER   read the mailbox. Cannot send, cannot change anything.
--   AGENT    read and send as the mailbox.
--   MANAGER  everything an AGENT can, plus manage members and edit the
--            connection itself.
--
-- ── REVOCATION IS A ROW, NOT A DELETE ───────────────────────────────────────
--
-- `revoked_at` rather than DELETE, because "who could see billing@ in March"
-- is a question the compliance work later in this programme has to answer, and
-- a deleted row answers it wrongly and silently. The unique index is partial on
-- revoked_at IS NULL, so re-granting after a revocation is a new row and the
-- history survives.
--
-- ── AND WHY THERE IS AN AUDIT TABLE AS WELL ─────────────────────────────────
--
-- The membership rows say who has access NOW and who had it before. The audit
-- says what happened and who did it — granted, revoked, role changed, and every
-- send made as a shared mailbox. Sending as a team address without recording
-- the human behind it is how accountability disappears, and it is exactly the
-- thing an auditor asks about first.
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_connection_member (
  email_connection_id uuid NOT NULL REFERENCES email_connection(email_connection_id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  member_role         text NOT NULL DEFAULT 'AGENT'
                        CHECK (member_role IN ('VIEWER','AGENT','MANAGER')),
  granted_by          uuid REFERENCES app_user(user_id),
  granted_at          timestamptz NOT NULL DEFAULT now(),
  revoked_at          timestamptz,
  revoked_by          uuid REFERENCES app_user(user_id),
  email_connection_member_id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

-- One live grant per person per mailbox; revoked ones accumulate as history.
CREATE UNIQUE INDEX IF NOT EXISTS ux_email_connection_member_live
  ON email_connection_member (email_connection_id, user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_email_connection_member_user
  ON email_connection_member (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_email_connection_member_conn
  ON email_connection_member (email_connection_id);

CREATE TABLE IF NOT EXISTS email_access_audit (
  email_access_audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_connection_id   uuid REFERENCES email_connection(email_connection_id) ON DELETE SET NULL,
  action                text NOT NULL CHECK (action IN
                          ('GRANTED','REVOKED','ROLE_CHANGED','SENT_AS','MAILBOX_HANDOVER','MAILBOX_ARCHIVED')),
  subject_user_id       uuid REFERENCES app_user(user_id) ON DELETE SET NULL,  -- who the grant is about
  actor_user_id         uuid REFERENCES app_user(user_id) ON DELETE SET NULL,  -- who did it
  detail                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_email_access_audit_conn
  ON email_access_audit (email_connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_email_access_audit_created
  ON email_access_audit (created_at DESC);

-- ── Backfill ────────────────────────────────────────────────────────────────
-- 10723 reclassified any surplus PERSONAL connections to SHARED. Their owners
-- must keep working them, so record each as MANAGER of their own mailbox. Owners
-- of genuinely shared mailboxes get the same, since until now "owner" was the
-- only access concept there was.
INSERT INTO email_connection_member (email_connection_id, user_id, member_role, granted_by)
SELECT c.email_connection_id, c.owner_user_id, 'MANAGER', c.owner_user_id
  FROM email_connection c
 WHERE c.owner_user_id IS NOT NULL
   AND c.kind = 'SHARED'
   AND NOT EXISTS (
     SELECT 1 FROM email_connection_member m
      WHERE m.email_connection_id = c.email_connection_id
        AND m.user_id = c.owner_user_id
        AND m.revoked_at IS NULL)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE email_connection_member IS
  'Who may work a shared or delegated mailbox, and at what level. Personal mailboxes need no rows — the owner is the access.';
COMMENT ON COLUMN email_connection_member.revoked_at IS
  'Set instead of deleting, so "who had access in March" stays answerable. The live-grant unique index is partial on this being NULL.';

-- DOWN
--   DROP INDEX IF EXISTS ix_email_access_audit_created;
--   DROP INDEX IF EXISTS ix_email_access_audit_conn;
--   DROP INDEX IF EXISTS ix_email_connection_member_conn;
--   DROP INDEX IF EXISTS ix_email_connection_member_user;
--   DROP INDEX IF EXISTS ux_email_connection_member_live;
--   -- DESTRUCTIVE: drops every access grant and the whole access history. A
--   -- shared mailbox reverts to being reachable only through owner_user_id, so
--   -- anyone granted access after this migration loses it.
--   DROP TABLE IF EXISTS email_access_audit;
--   DROP TABLE IF EXISTS email_connection_member;
