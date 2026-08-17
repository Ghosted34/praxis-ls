-- ============================================================================
-- TENANT DB — 10707 client portal secure messaging (PRD §11.1 "secure
-- messaging with certified PDF export of the chat").
--
-- A per-client thread between the account team (STAFF) and the client's
-- portal users (CLIENT). Optionally tied to a dossier so a conversation can
-- stay scoped to one shipment. The certified PDF export renders this thread
-- and vaults it (content hash + QR), so the conversation is auditable like
-- any other document.
-- ============================================================================

CREATE TABLE client_message (
  message_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES client_master(client_id) ON DELETE CASCADE,
  dossier_id      uuid REFERENCES dossier(dossier_id),
  direction       text NOT NULL CHECK (direction IN ('STAFF','CLIENT')),
  body            text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  author_user_id  uuid REFERENCES app_user(user_id),
  author_email    citext,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_client_message_client ON client_message(client_id, created_at);

-- DOWN
--   DROP TABLE IF EXISTS client_message;
