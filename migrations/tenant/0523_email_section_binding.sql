-- ============================================================================
-- TENANT DB — 0523 Section-sender BINDINGS (WS-E3).
--
-- A section sender (email_identity) can be BOUND to one or more ERP sections.
-- When the system sends mail for a section, email.service.resolveMail resolves
-- the BOUND sender first, then falls back to the legacy purpose-label match,
-- then the tenant default, then the platform (Praxis) fallback.
--
-- A section maps to at most ONE sender — UNIQUE(section_key). Claiming a section
-- for a new sender re-points it (ON CONFLICT DO UPDATE in the repo). Deleting a
-- sender cascades its bindings.
--
-- This is what makes an arbitrary tenant-created section actually get used: the
-- send path consults the binding rather than a hardcoded purpose string.
-- Additive + idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_section_binding (
  email_section_binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_identity_id uuid NOT NULL REFERENCES email_identity(email_identity_id) ON DELETE CASCADE,
  section_key       text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (section_key)
);

CREATE INDEX IF NOT EXISTS ix_email_section_binding_identity
  ON email_section_binding(email_identity_id);


-- DOWN
-- DROP TABLE IF EXISTS email_section_binding CASCADE;
