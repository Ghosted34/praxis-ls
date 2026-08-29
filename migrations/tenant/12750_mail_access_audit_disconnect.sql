-- ==============================================================================
-- TENANT DB — 12750 Record MAILBOX_DISCONNECTED in the mail access audit
--
-- 10725 fixed the audit vocabulary to six verbs:
--
--   GRANTED · REVOKED · ROLE_CHANGED · SENT_AS · MAILBOX_HANDOVER · MAILBOX_ARCHIVED
--
-- and that list matched what the product could do at the time. It could not
-- disconnect a mailbox — the action had no service and no button, so a person
-- who connected their own address had no way to un-connect it, and even an
-- administrator's "Retire" only stopped the sync and left the stored IMAP
-- password sitting in `integration_secret`.
--
-- `mailbox.service.disconnect` is that action: archive, then FORGET the
-- credential. It is a different event from an archive and has to be findable as
-- one — "when did we stop holding this password?" is exactly the question an
-- access audit exists to answer, and folding it into MAILBOX_ARCHIVED would
-- make the two indistinguishable in the log for ever after.
--
-- Idempotent: the constraint is dropped by name and recreated, so re-running
-- lands on the same seven-verb definition. Guarded on the table existing, for a
-- tenant provisioned before 10725.
-- ==============================================================================

DO $$
BEGIN
  IF to_regclass('public.email_access_audit') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE email_access_audit
    DROP CONSTRAINT IF EXISTS email_access_audit_action_check;

  ALTER TABLE email_access_audit
    ADD CONSTRAINT email_access_audit_action_check
    CHECK (action IN (
      'GRANTED', 'REVOKED', 'ROLE_CHANGED', 'SENT_AS',
      'MAILBOX_HANDOVER', 'MAILBOX_ARCHIVED', 'MAILBOX_DISCONNECTED'
    ));
END $$;

COMMENT ON TABLE email_access_audit IS
  'Who was given, or lost, access to which mailbox — and the mailbox-level events (handover, archive, disconnect) that change who can reach one.';

-- DOWN
--   -- Only safe once no MAILBOX_DISCONNECTED rows remain.
--   ALTER TABLE email_access_audit DROP CONSTRAINT IF EXISTS email_access_audit_action_check;
--   ALTER TABLE email_access_audit ADD CONSTRAINT email_access_audit_action_check
--     CHECK (action IN ('GRANTED','REVOKED','ROLE_CHANGED','SENT_AS','MAILBOX_HANDOVER','MAILBOX_ARCHIVED'));
