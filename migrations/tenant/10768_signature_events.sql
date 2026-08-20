-- ============================================================================
-- TENANT DB — 10744 Signature and deliverability event types (PR-2).
-- ============================================================================

INSERT INTO event_type (key, module_key, name, description) VALUES
  ('signature.template.changed',  'MOD-70', 'Signature template changed',  'An administrator edited a signature template. Cached renders for that template are invalidated.'),
  ('signature.profile.changed',   'MOD-72', 'Signature profile changed',   'A user edited their own signature profile (phones, pronouns, credentials).'),
  ('signature.cache.invalidated', 'MOD-72', 'Signature cache invalidated', 'Cached HTML/PNG renders were dropped because an input they were hashed over changed.'),
  ('deliverability.regressed',    'MOD-70', 'Deliverability regressed',    'A sending domain moved from PASS to FAIL on SPF, DKIM, DMARC, MX, PTR or an RBL. MOD-70 holders are notified because invoices stop arriving before anyone notices the DNS.')
ON CONFLICT (key) DO NOTHING;

-- DOWN
--   DELETE FROM event_type WHERE key IN (
--     'signature.template.changed','signature.profile.changed',
--     'signature.cache.invalidated','deliverability.regressed');
