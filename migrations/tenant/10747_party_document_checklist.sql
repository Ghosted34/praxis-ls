-- ============================================================================
-- TENANT DB — 10747 Document requirements + inbound classification (PR-3).
-- Never files silently.
-- ============================================================================

CREATE TABLE IF NOT EXISTS document_requirement (
  document_requirement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_kind   text NOT NULL CHECK (scope_kind IN ('CLIENT_TYPE','SERVICE_TYPE','GLOBAL')),
  scope_value  text,
  doc_type_code text NOT NULL,
  is_mandatory boolean NOT NULL DEFAULT true,
  applies_to   text NOT NULL DEFAULT 'CLIENT' CHECK (applies_to IN ('CLIENT','DOSSIER')),
  validity_days integer,
  sort_order   integer NOT NULL DEFAULT 100,
  is_active    boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS document_requirement_scope_uq
  ON document_requirement (scope_kind, COALESCE(scope_value, ''), doc_type_code);

CREATE TABLE IF NOT EXISTS email_attachment_classification (
  email_attachment_classification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_attachment_id uuid NOT NULL REFERENCES email_attachment(email_attachment_id) ON DELETE CASCADE,
  suggested_doc_type_code text,
  suggested_entity_ref text,
  confidence   numeric(4,3),
  extracted    jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'SUGGESTED'
                 CHECK (status IN ('SUGGESTED','FILED','REJECTED')),
  filed_doc_id uuid,
  decided_by   uuid REFERENCES app_user(user_id),
  decided_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO document_requirement (scope_kind, scope_value, doc_type_code, applies_to, sort_order) VALUES
  ('SERVICE_TYPE', 'IMPORT', 'BL_AWB', 'DOSSIER', 10),
  ('SERVICE_TYPE', 'IMPORT', 'COMMERCIAL_INVOICE', 'DOSSIER', 20),
  ('SERVICE_TYPE', 'IMPORT', 'PACKING_LIST', 'DOSSIER', 30),
  ('SERVICE_TYPE', 'IMPORT', 'CUSTOMS_DECLARATION', 'DOSSIER', 40),
  ('SERVICE_TYPE', 'EXPORT', 'COMMERCIAL_INVOICE', 'DOSSIER', 10),
  ('SERVICE_TYPE', 'EXPORT', 'PACKING_LIST', 'DOSSIER', 20),
  ('SERVICE_TYPE', 'EXPORT', 'CERTIFICATE_OF_ORIGIN', 'DOSSIER', 30),
  ('SERVICE_TYPE', 'EXPORT', 'EXPORT_DECLARATION', 'DOSSIER', 40),
  ('GLOBAL', NULL, 'RCCM', 'CLIENT', 10),
  ('GLOBAL', NULL, 'NIU', 'CLIENT', 20),
  ('GLOBAL', NULL, 'ID_SIGNATORY', 'CLIENT', 30),
  ('GLOBAL', NULL, 'BANK_DETAILS', 'CLIENT', 40)
ON CONFLICT DO NOTHING;

-- DOWN
--   DROP TABLE IF EXISTS email_attachment_classification;
--   DROP TABLE IF EXISTS document_requirement;
