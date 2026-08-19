-- ============================================================================
-- TENANT DB — 10739 Event types for composing and sending.
--
-- `email.sent` already exists (0483) and still means "a message left the
-- building". These describe the states around it that only exist because the
-- send is a queue: held, cancelled before it left, and failed after trying.
--
-- `email.send.failed` matters most. Before the queue, a failed send was an HTTP
-- error the composer showed and the user could act on immediately. Now the
-- failure happens minutes later in a worker with nobody watching, so it has to
-- reach the sender some other way — this is what the notification bell
-- subscribes to.
-- ============================================================================

INSERT INTO event_type (key, module_key, name, description) VALUES
  ('email.send.held',      'MOD-72', 'Send held',        'A message was composed and is waiting out its undo window before leaving.'),
  ('email.send.cancelled', 'MOD-72', 'Send cancelled',   'The sender undid a send before it left the building.'),
  ('email.send.failed',    'MOD-72', 'Send failed',      'A queued message could not be delivered after its retries. The sender is notified, because by then nobody is watching the composer.'),
  ('email.draft.saved',    'MOD-72', 'Draft saved',      'A draft was autosaved. Emitted once per draft rather than per keystroke.'),
  ('email.attachment.added','MOD-72','Attachment added', 'A file was attached to a draft, either uploaded or referenced from the document vault.')
ON CONFLICT (key) DO NOTHING;

-- DOWN
--   -- DESTRUCTIVE: removes the event types. Rows already in event_log keep their
--   -- key as text so history stays readable, but any workflow bound to one of
--   -- these stops firing.
--   DELETE FROM event_type WHERE key IN (
--     'email.send.held','email.send.cancelled','email.send.failed',
--     'email.draft.saved','email.attachment.added');
