-- F10: governed document type used when an accepted partnership application
-- becomes a supplier. The scan remains pending manual compliance verification.
INSERT INTO party_document_type (
  code, name, applies_to, is_system, is_active,
  requires_expiry, requires_issuing_authority, default_severity
) VALUES (
  'PARTNERSHIP_PROFILE', 'Partnership application profile', 'SUPPLIER',
  true, true, false, false, 'WARN'
)
ON CONFLICT (code) DO NOTHING;
