CREATE TABLE IF NOT EXISTS party_verified_domain (
  party_verified_domain_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_kind  text NOT NULL CHECK (party_kind IN ('CLIENT','SUPPLIER')),
  party_id    uuid NOT NULL,
  domain      citext NOT NULL,
  source      text NOT NULL CHECK (source IN ('ADMIN_VERIFIED','OBSERVED','IMPORTED')),
  verified_by uuid REFERENCES app_user(user_id),
  verified_at timestamptz,
  message_count integer NOT NULL DEFAULT 0,
  UNIQUE (party_kind, party_id, domain)
);
ALTER TABLE email_message ADD COLUMN IF NOT EXISTS auth_verdict text;
ALTER TABLE email_message ADD COLUMN IF NOT EXISTS auth_detail jsonb NOT NULL DEFAULT '{}'::jsonb;
DO $$ BEGIN
  ALTER TABLE email_message ADD CONSTRAINT ck_email_message_auth_verdict
    CHECK (auth_verdict IS NULL OR auth_verdict IN ('VERIFIED','UNVERIFIED','SUSPICIOUS','LIKELY_IMPERSONATION'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- DOWN
--   DROP TABLE IF EXISTS party_verified_domain;
