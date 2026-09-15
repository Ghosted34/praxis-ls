-- Assignment is a first-class mail event so in-app/push/email fallback
-- notifications can reference a registered event type.
INSERT INTO event_type (key, module_key, name, description) VALUES
  ('email.thread.assigned', 'MOD-72', 'Email thread assigned',
   'A conversation was handed to a named colleague for review and treatment.')
ON CONFLICT (key) DO NOTHING;

-- DOWN
--   DELETE FROM event_type WHERE key = 'email.thread.assigned';
