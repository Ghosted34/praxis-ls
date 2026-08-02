-- ============================================================================
-- TENANT DB — 0480 Provider-agnostic email engine: connections.
-- See doc/EMAIL_ENGINE_PLAN.md. Phase 1 = IMAP/SMTP; Graph/Gmail (OAuth) land in
-- Phase 2 behind the same table (provider + secret_key + sync_cursor cover them).
--
-- Isolation is the DB boundary (database-per-tenant), so NO tenant/company column.
-- Credentials are NEVER stored here: secret_key points at an integration_secret
-- setting row (AES-256-GCM), read via settingService.readSecret — same pattern as
-- email_smtp_pass / whatsapp_token.
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_connection (
  email_connection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_address     citext NOT NULL,
  provider          text NOT NULL DEFAULT 'imap_smtp'
                      CHECK (provider IN ('imap_smtp','microsoft_graph','google_gmail')),
  display_name      text,

  -- IMAP/SMTP transport (Phase 1). Passwords/tokens live in the integration_secret
  -- setting section, NOT in these columns.
  imap_host   text,
  imap_port   integer,
  imap_secure boolean NOT NULL DEFAULT true,
  smtp_host   text,
  smtp_port   integer,
  smtp_secure boolean NOT NULL DEFAULT true,
  auth_user   text,
  secret_key  text,                 -- setting key in section integration_secret (password / OAuth bundle)

  -- OAuth (Phase 2) — token bundle lives under secret_key; this is just the expiry hint.
  token_expires_at  timestamptz,

  -- Sync state — a CURSOR, never a timestamp:
  --   IMAP  : {"uidvalidity":<int>,"last_uid":<int>}
  --   Graph : {"delta_link":"<url>"}      (Phase 2)
  --   Gmail : {"history_id":"<id>"}       (Phase 2)
  sync_cursor       jsonb,

  -- Push subscriptions (Phase 2 providers only; NULL for IMAP).
  push_subscription_id text,
  push_expires_at   timestamptz,

  status            text NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','CONNECTED','ERROR','DISABLED')),
  last_sync_at      timestamptz,
  last_error        text,

  -- Optional link to the purpose-based OUTBOUND sender identity (0410). A
  -- connection is a mailbox we read/send from; an identity is deliverability +
  -- From branding. Kept distinct on purpose.
  email_identity_id uuid REFERENCES email_identity(email_identity_id),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (email_address, provider)
);

CREATE INDEX IF NOT EXISTS ix_email_connection_active
  ON email_connection(status) WHERE status = 'CONNECTED';

CREATE TRIGGER trg_email_connection_updated
  BEFORE UPDATE ON email_connection
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Register the engine's events so they appear in workflow/notification config
-- (modules register their events — DB_ARCHITECTURE §4.3). MOD-64 = Comms surface.
INSERT INTO event_type (key, module_key, name, description) VALUES
  ('email.received', 'MOD-64', 'Email received', 'An inbound message was ingested into a connected mailbox.'),
  ('email.sent',     'MOD-64', 'Email sent',     'An outbound message was sent from a connected mailbox.')
ON CONFLICT (key) DO NOTHING;
