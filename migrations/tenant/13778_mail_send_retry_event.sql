-- ============================================================================
-- TENANT DB — 13778 Event type for retrying a send that failed.
--
-- 10739 seeded the states the queue reaches on its own: held, cancelled,
-- failed. This is the one a PERSON causes. The queue stops retrying a failure
-- only a human can clear — a rejected sender address, an expired SMTP
-- password, a recipient the host does not have — and the outbox now has the
-- button that acts on the fix.
--
-- Worth its own key rather than folding into `email.send.held`: the ledger
-- entry carries what the message failed with LAST time, which is the only
-- record of what was being fixed once the retry clears the row's own
-- `last_error`. It is also the answer to "why did this leave hours after it was
-- written", which a held/cancelled/failed trail alone cannot give.
-- ============================================================================

INSERT INTO event_type (key, module_key, name, description) VALUES
  ('email.send.retried', 'MOD-72', 'Send retried', 'Somebody sent a failed message again from the outbox, after fixing what the mail server refused it for. The entry keeps the previous error.')
ON CONFLICT (key) DO NOTHING;

-- DOWN
--   -- DESTRUCTIVE: removes the event type. Rows already in event_log keep their
--   -- key as text so history stays readable, but any workflow bound to it stops
--   -- firing.
--   DELETE FROM event_type WHERE key = 'email.send.retried';
