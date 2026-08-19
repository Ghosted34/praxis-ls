-- ============================================================================
-- TENANT DB — 10729 Event types for the mailbox foundation.
--
-- These join `email.received` / `email.sent` (0483) on MOD-64. They exist so the
-- orchestration engine and the notification fan-out have something to subscribe
-- to, and so the audit trail reads as a sequence of named things that happened
-- rather than a diff of rows.
--
-- Access changes are marked security-critical: granting somebody the ability to
-- read billing@ or send as it is a permission change in everything but name,
-- and it should reach the CEO notification path like one.
-- ============================================================================

INSERT INTO event_type (key, module_key, name, description, is_security_critical) VALUES
  ('mailbox.connected',    'MOD-72', 'Mailbox connected',      'A mailbox was connected and verified.', false),
  ('mailbox.archived',     'MOD-72', 'Mailbox archived',       'A mailbox was retired — sync stopped, mail retained.', false),
  ('mailbox.handover',     'MOD-72', 'Mailbox handed over',    'A personal mailbox was converted to a shared one so a team can work its backlog.', true),
  ('mailbox.access.granted','MOD-72','Mailbox access granted', 'Someone was given access to a shared or delegated mailbox.', true),
  ('mailbox.access.revoked','MOD-72','Mailbox access revoked', 'Someone''s access to a mailbox was withdrawn.', true),
  ('mailbox.health.failed','MOD-72', 'Mailbox unhealthy',      'A mailbox has failed to connect repeatedly and needs attention.', false),
  ('mail.send_point.bound','MOD-72', 'Send point rebound',     'An ERP send point was pointed at a different sender address.', true),
  ('mail.send.throttled',  'MOD-72', 'Send held by rate limit','A message was held for the next window to stay under the host''s send limit.', false)
ON CONFLICT (key) DO NOTHING;

-- DOWN
--   DELETE FROM event_type WHERE key IN (
--     'mailbox.connected','mailbox.archived','mailbox.handover',
--     'mailbox.access.granted','mailbox.access.revoked','mailbox.health.failed',
--     'mail.send_point.bound','mail.send.throttled');
