-- ============================================================================
-- TENANT DB — 0522 Per-user mailbox ownership.
--
-- A connected mailbox (email_connection) now BELONGS to the user who connected
-- it: users see and send from ONLY their own. `is_default` marks a user's
-- send-from box; at most one default per owner (partial unique index). Owner is
-- captured on connect (OAuth state user / IMAP actor); legacy rows have a NULL
-- owner and are claimed by the next user who reconnects that mailbox.
--
-- Additive + idempotent. Mail is live-pinned (identityDb), so email_connection
-- and app_user resolve in the same schema and the FK is satisfiable.
-- See doc/INTEGRATION_PLAN.md WS-E8.
-- ============================================================================

ALTER TABLE email_connection ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES app_user(user_id);
ALTER TABLE email_connection ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- One default mailbox per owner. Partial index; NULL owners (legacy rows) are
-- ignored so they never collide.
CREATE UNIQUE INDEX IF NOT EXISTS ux_email_connection_owner_default
  ON email_connection (owner_user_id) WHERE is_default;


-- DOWN: If we ever need to roll back, we can restore the CHECK and drop the column.
-- ALTER TABLE email_connection DROP COLUMN IF EXISTS owner_user_id;
-- ALTER TABLE email_connection DROP COLUMN IF EXISTS is_default;
-- DROP INDEX IF EXISTS ux_email_connection_owner_default;