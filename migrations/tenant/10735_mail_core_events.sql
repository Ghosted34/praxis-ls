-- ============================================================================
-- TENANT DB — 10735 Event types for the thread model.
--
-- These join `email.received` / `email.sent` (0483) and PR-0's mailbox events.
-- They exist so the orchestration engine has something to subscribe to when a
-- conversation changes state, rather than each feature polling for it.
-- ============================================================================

INSERT INTO event_type (key, module_key, name, description) VALUES
  ('email.thread.created',  'MOD-72', 'Email thread started',   'A new conversation appeared in a connected mailbox.'),
  ('email.thread.replied',  'MOD-72', 'Email thread replied',   'A new message joined an existing conversation.'),
  ('email.message.moved',   'MOD-72', 'Message moved',          'A message was moved between folders.'),
  ('email.thread.read',     'MOD-72', 'Thread read',            'A user read a conversation — recorded per user, not per mailbox.'),
  ('email.folder.discovered','MOD-72','Mail folder discovered', 'A new folder was found on a connected mail server.'),
  ('email.stream.corrected','MOD-72', 'Stream corrected',       'A user moved a conversation between the Human and System streams, overriding the classifier.')
ON CONFLICT (key) DO NOTHING;

-- DOWN
--   -- DESTRUCTIVE: removes the event types. Rows already written to event_log
--   -- keep their key as text, so history is readable, but any workflow bound to
--   -- one of these stops firing.
--   DELETE FROM event_type WHERE key IN (
--     'email.thread.created','email.thread.replied','email.message.moved',
--     'email.thread.read','email.folder.discovered','email.stream.corrected');
