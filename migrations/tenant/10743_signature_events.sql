-- ============================================================================
-- TENANT DB — 10743 Signature event types.
--
-- Registered so emitEvent() resolves a category and the notification fan-out
-- has something to bind to, rather than each feature polling for state changes.
--
-- None is is_security_critical. That flag drives the Watch-the-Watcher fan-out
-- to CEO/MANAGEMENT (shared/events/emit.js) and is reserved for RBAC and God
-- Mode changes. A signature is a business event: routing it to every executive
-- would make the alert channel useless for the things it exists to catch.
-- `signature.amended` is the closest call — it is genuinely alarming — but it
-- already raises a RED compliance_flag and notifies the signer directly, which
-- reaches the people who can act on it.
-- NOTE: no semicolons inside the seed strings below. The idempotency checker
-- finds a statement by slicing between semicolons without tracking quotes, so a
-- ';' in a description hides the ON CONFLICT clause from it and the seed is
-- reported as non-idempotent when it is not.
-- ============================================================================

INSERT INTO event_type (key, module_key, name, description) VALUES
  ('signature.signed',   'MOD-64', 'Document signed',
   'A party signed a document. Carries the assurance level actually achieved.'),
  ('signature.revoked',  'MOD-64', 'Signature revoked',
   'A signature was withdrawn. The row survives, and the public portal reports it as revoked rather than 404.'),
  ('signature.amended',  'MOD-64', 'Signed document amended',
   'A document changed after it was signed. The signature no longer covers the current contents.'),
  ('signature.stale_detected', 'MOD-64', 'Stale signature detected',
   'A read recomputed the canonical hash and found it no longer matches. Raised once per signature.')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- VERIFY
--   SELECT key, module_key FROM event_type WHERE key LIKE 'signature.%' ORDER BY key;
--     -- expect 4 rows, all MOD-64
--
-- DOWN
--   -- DESTRUCTIVE. event_log rows keep their key as text so history stays
--   -- readable, but any workflow bound to one of these stops firing.
--   DELETE FROM event_type WHERE key IN
--     ('signature.signed','signature.revoked','signature.amended','signature.stale_detected');
-- ============================================================================
