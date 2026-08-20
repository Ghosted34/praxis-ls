CREATE TABLE IF NOT EXISTS attachment_extraction (
  attachment_extraction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_attachment_id uuid NOT NULL REFERENCES email_attachment(email_attachment_id) ON DELETE CASCADE,
  doc_kind    text NOT NULL CHECK (doc_kind IN
                ('SUPPLIER_INVOICE','RECEIPT','CLIENT_PO','PROOF_OF_PAYMENT','CHEQUE','UNKNOWN')),
  fields      jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw         text,
  matches     jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence  numeric(4,3),
  provider    text, model text, page_count integer,
  status      text NOT NULL DEFAULT 'EXTRACTED'
                CHECK (status IN ('EXTRACTED','REVIEWED','DISMISSED','FAILED')),
  reviewed_by uuid REFERENCES app_user(user_id),
  reviewed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- DOWN
--   DROP TABLE IF EXISTS attachment_extraction;
