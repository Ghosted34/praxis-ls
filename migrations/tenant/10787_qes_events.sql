-- ============================================================================
-- TENANT DB — 10787 The QES events.
--
-- doc/SIGNATURE_ENGINEERING_GUIDE.md §7.3.
--
-- One row beyond the plan's four, and the reason is stated rather than
-- buried: §7.3's own schema gives the envelope a DECLINED state, and a
-- terminal state with no event is a chain that declined with no
-- notification to the creator — the exact hole the mail programme's event
-- rows exist to close. `qes.envelope_declined` fills it.
--
-- `qes.*`, and not `document_signature.*` or `signature.*`: the envelope is
-- the provider's object and its lifecycle is the provider's, so it gets its
-- own prefix the way the mail programme owns `signature.*` for EMAIL
-- signatures (10768). categories.js maps the prefix to a notification
-- category, and a future reader of the event log should see at a glance that
-- this row is about a third-party envelope, not about an act on our own
-- signing path.
--
-- None is `is_security_critical`: an envelope completing is a business event.
-- The act of signing is `document_signature.signed`, which fires separately
-- and carries the evidence.
--
-- NOTE: no semicolons inside the seed strings. The idempotency checker finds
-- a statement by slicing between semicolons without tracking quotes.
-- ============================================================================

INSERT INTO event_type (key, module_key, name, description) VALUES
  ('qes.envelope_created', 'MOD-64', 'Certified envelope sent',
   'A certified envelope was created and sent to the external provider. The ledger row charging it was written in the same transaction as the provider reference.'),
  ('qes.envelope_completed', 'MOD-64', 'Certified envelope completed',
   'The provider reports every recipient signed. The signed document and the provider''s audit certificate were mirrored into the vault and the signature was written.'),
  ('qes.envelope_declined', 'MOD-64', 'Certified envelope declined',
   'The signer declined on the provider''s platform. The party and the request settle as declined, and earlier signatures in the chain remain valid records of what those parties attested to.'),
  ('qes.envelope_failed', 'MOD-64', 'Certified envelope failed',
   'A certified envelope reached a failed state: a provider error, a document amended after dispatch, or a request that closed before the provider finished.'),
  ('qes.quota_low', 'MOD-64', 'Certified signature quota low',
   'Platform-level alert: the monthly certified envelope allowance across all tenants crossed 80 or 95 percent. Routed to the platform alert channels, never to a tenant.')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- VERIFY
--   SELECT key FROM event_type WHERE key LIKE 'qes.%' ORDER BY key;  -- expect 5
--
-- DOWN
--   DELETE FROM event_type WHERE key IN
--     ('qes.envelope_created','qes.envelope_completed','qes.envelope_declined',
--      'qes.envelope_failed','qes.quota_low');
-- ============================================================================
