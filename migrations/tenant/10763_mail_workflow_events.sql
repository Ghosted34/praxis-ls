INSERT INTO event_type (key, module_key, name, description) VALUES
  ('mail.sla.breached', 'MOD-72', 'SLA breached', 'A shared-inbox thread missed its first-response or resolution clock.'),
  ('mail.followup.fired', 'MOD-72', 'Follow-up fired', 'A snooze or no-reply boomerang returned a thread.'),
  ('mail.breakglass.read', 'MOD-72', 'Break-glass read', 'God-Mode read of a Private thread. Always ledgered.'),
  ('secure_link.viewed', 'MOD-72', 'Secure link viewed', 'The only open signal in the product — a first-party view of an expiring link.')
ON CONFLICT (key) DO NOTHING;
-- DOWN
--   DELETE FROM event_type WHERE key IN ('mail.sla.breached','mail.followup.fired','mail.breakglass.read','secure_link.viewed');
