-- ============================================================================
-- TENANT DB — 10790 Wet-signature event types.
--
-- document_signature.* rather than signature.* for the namespace reason recorded
-- in 10774 and 10784: mail signatures already own the shorter prefix.
--
-- Idempotent. Re-runnable.
-- ============================================================================

INSERT INTO event_type (key, module_key, name, description) VALUES
  ('document_signature.printed', 'MOD-64', 'Paper signature copy printed',
   'A paper-signature copy was issued with its own DataMatrix reconciliation code.'),
  ('document_signature.scanned_returned', 'MOD-64', 'Paper signature scan returned',
   'A returned paper-signature scan was uploaded, emailed in or captured from mobile.'),
  ('document_signature.reconciled', 'MOD-64', 'Paper signature reconciled',
   'A returned scan was matched back to a print job and recorded as a wet signature.'),
  ('document_signature.reconcile_review', 'MOD-64', 'Paper signature needs review',
   'A returned scan decoded poorly or failed corroboration and needs an operator decision.')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- VERIFY
--   SELECT key FROM event_type WHERE key IN
--     ('document_signature.printed','document_signature.scanned_returned',
--      'document_signature.reconciled','document_signature.reconcile_review')
--    ORDER BY key;
--
-- DOWN
--   -- DELETE FROM event_type WHERE key IN
--   --   ('document_signature.printed','document_signature.scanned_returned',
--   --    'document_signature.reconciled','document_signature.reconcile_review');
-- ============================================================================
