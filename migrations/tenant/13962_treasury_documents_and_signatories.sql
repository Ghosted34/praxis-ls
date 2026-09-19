-- ============================================================================
-- TENANT DB — Treasury account documents and signatories (PR-03, Audit #1-3, #15)
-- ============================================================================

CREATE TABLE IF NOT EXISTS treasury_account_document (
  document_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treasury_account_id uuid NOT NULL REFERENCES treasury_account(treasury_account_id) ON DELETE CASCADE,
  document_type       text NOT NULL CHECK (document_type IN ('BANK_RIB','BANK_MANDATE','KYC_DOCUMENT','SIGNATURE_CARD','ACCOUNT_LETTER','OTHER')),
  title               text NOT NULL,
  document_number     text,
  vault_id            uuid REFERENCES document_vault(doc_id),
  file_name           text,
  file_size           int,
  mime_type           text,
  issue_date          date,
  expiry_date         date,
  upload_status       text NOT NULL DEFAULT 'COMPLETED' CHECK (upload_status IN ('PENDING_UPLOAD','COMPLETED','FAILED')),
  is_verified         boolean NOT NULL DEFAULT false,
  verified_by         uuid REFERENCES app_user(user_id),
  verified_at         timestamptz,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES app_user(user_id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (expiry_date IS NULL OR issue_date IS NULL OR expiry_date >= issue_date)
);

CREATE INDEX IF NOT EXISTS ix_treasury_doc_account ON treasury_account_document(treasury_account_id);
CREATE INDEX IF NOT EXISTS ix_treasury_doc_vault   ON treasury_account_document(vault_id);

CREATE TABLE IF NOT EXISTS treasury_account_signatory (
  signatory_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treasury_account_id uuid NOT NULL REFERENCES treasury_account(treasury_account_id) ON DELETE CASCADE,
  user_id             uuid REFERENCES app_user(user_id),
  person_id           uuid REFERENCES entity_person(person_id) ON DELETE SET NULL,
  full_name           text NOT NULL,
  email               citext,
  phone               text,
  role_title          text,
  signatory_type      text NOT NULL DEFAULT 'PRIMARY' CHECK (signatory_type IN ('PRIMARY','JOINT')),
  rule_type           text NOT NULL DEFAULT 'SINGLE_SIGNATURE' CHECK (rule_type IN ('SINGLE_SIGNATURE','JOINT_REQUIRED')),
  limit_amount        numeric(20,4),
  currency            char(3) NOT NULL DEFAULT 'XAF',
  effective_from      date NOT NULL DEFAULT CURRENT_DATE,
  effective_to        date,
  is_active           boolean NOT NULL DEFAULT true,
  signature_card_doc_id uuid REFERENCES treasury_account_document(document_id) ON DELETE SET NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES app_user(user_id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS ix_treasury_sig_account ON treasury_account_signatory(treasury_account_id);
CREATE INDEX IF NOT EXISTS ix_treasury_sig_user    ON treasury_account_signatory(user_id);

-- DOWN
-- DROP TABLE IF EXISTS treasury_account_signatory;
-- DROP TABLE IF EXISTS treasury_account_document;
