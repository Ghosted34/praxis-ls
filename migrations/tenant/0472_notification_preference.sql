-- ============================================================================
-- TENANT DB — 0472 per-user notification preferences. The read/write API
-- (GET/PUT /notifications/preferences) and the Preferences UI already shipped,
-- but the backing table was never created, so saving prefs failed at runtime.
-- This provisions it. Rows store explicit opt-OUTS/opt-ins per (channel,
-- category); a MISSING row means "enabled" (see notification.repo.isChannelEnabled),
-- so the table stays small. Security-critical alerts ignore this table entirely.
-- ============================================================================
CREATE TABLE IF NOT EXISTS notification_preference (
  user_id     uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  channel     text NOT NULL CHECK (channel IN ('IN_APP','EMAIL','SMS','WHATSAPP')),
  category    text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel, category)
);
CREATE INDEX IF NOT EXISTS ix_notif_pref_user ON notification_preference (user_id);
