-- ============================================================================
-- TENANT DB — 11746 Make message deletion possible (audit H-1)
--
-- There was no deletion path anywhere in the mail module: the bulk verb list ran
-- read/unread/star/unstar/move/label/unlabel, Trash accumulated forever, the
-- provider's Trash was never emptied, and §9.6's promise that "deletion of an
-- archived message is blocked in the service layer" was vacuous because nothing
-- could delete anything.
--
-- The service side is `thread.service.remove` / `emptyFolder`. This migration
-- fixes the one FK that would have turned a legitimate delete into a 23503.
--
-- WHAT WAS IN THE WAY. Every child of `email_message` cascades except two:
--
--   · `email_archive.email_message_id`  — NO ACTION, and DELIBERATELY so. The
--     archive chain covers the message's body hash and its attachment hashes,
--     and it is a linked list: removing a link breaks verification for every
--     message after it. The service refuses these by name and ledgers the
--     attempt; this FK is the belt to that braces and must NOT be relaxed.
--
--   · `email_bounce.original_message_id` — NO ACTION, and only by omission.
--     10762 declared it as a plain nullable reference while its siblings in
--     10738 (`reply_to_message_id`, `sent_message_id`) both carry ON DELETE SET
--     NULL. So deleting a message that had ever bounced would fail with a
--     foreign-key violation surfacing as a 500, for no rule anyone intended.
--
-- A bounce is DERIVED data: the DSN itself is a separate `email_message` in the
-- System stream and is untouched here. Only the back-reference to the original
-- is nulled, which is the same treatment a deleted draft's reply target gets.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name = 'email_bounce'
  ) THEN
    ALTER TABLE email_bounce
      DROP CONSTRAINT IF EXISTS email_bounce_original_message_id_fkey;
    ALTER TABLE email_bounce
      ADD CONSTRAINT email_bounce_original_message_id_fkey
      FOREIGN KEY (original_message_id) REFERENCES email_message(email_message_id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- The empty-trash read is `WHERE m.folder = 'TRASH'` narrowed by the caller's
-- accessible mailboxes. Without this the only index on the path is the thread
-- one, so emptying Trash on a 50k-message mailbox seq-scans `email_message`.
CREATE INDEX IF NOT EXISTS ix_email_message_folder
  ON email_message (folder, email_connection_id);

COMMENT ON CONSTRAINT email_bounce_original_message_id_fkey ON email_bounce IS
  'ON DELETE SET NULL (11746): a bounce is derived data and must not block '
  'deletion of the message it describes. The DSN itself is a separate '
  'email_message row and is unaffected.';

-- DOWN
--   DROP INDEX IF EXISTS ix_email_message_folder;
--   ALTER TABLE email_bounce DROP CONSTRAINT IF EXISTS email_bounce_original_message_id_fkey;
--   ALTER TABLE email_bounce
--     ADD CONSTRAINT email_bounce_original_message_id_fkey
--     FOREIGN KEY (original_message_id) REFERENCES email_message(email_message_id);
