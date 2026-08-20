INSERT INTO event_type (key, module_key, name, description) VALUES
  ('email.thread.bound',     'MOD-72', 'Thread bound',     'A human accepted a binding suggestion or bound a thread manually.'),
  ('email.thread.unbound',   'MOD-72', 'Thread unbound',   'A human removed a binding. Audited because a silent detach is a support call nobody can answer.'),
  ('email.note.created',     'MOD-72', 'Internal note',    'An internal note was added to a thread. Never sent outward.'),
  ('mention.created',        'MOD-72', 'Mention',          'Someone was mentioned on an internal note.'),
  ('email.attachment.filed', 'MOD-72', 'Attachment filed', 'An inbound attachment was classified and filed into the vault / Client 360 after human confirmation.')
ON CONFLICT (key) DO NOTHING;

-- DOWN
--   DELETE FROM event_type WHERE key IN (
--     'email.thread.bound','email.thread.unbound','email.note.created',
--     'mention.created','email.attachment.filed');
