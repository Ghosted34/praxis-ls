-- ============================================================================
-- TENANT DB — 10710 Smart Comms acknowledgement (G22)
--
-- The legacy chat had `acknowledge`, which stamped acknowledged_at on a
-- specific message — a read receipt on a directive, distinct from having read
-- the channel. comms_message has no such column; a directive sent in Smart
-- Comms could never be proven received. These two columns give a message its
-- receipt; the sender sees who has acknowledged (endpoint + list).
-- ============================================================================

ALTER TABLE comms_message
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid REFERENCES app_user(user_id);

CREATE INDEX IF NOT EXISTS ix_msg_ack ON comms_message(acknowledged_at)
  WHERE acknowledged_at IS NOT NULL;

-- DOWN
--   DROP INDEX IF EXISTS ix_msg_ack;
--   ALTER TABLE comms_message
--     DROP COLUMN IF EXISTS acknowledged_by,
--     DROP COLUMN IF EXISTS acknowledged_at;
