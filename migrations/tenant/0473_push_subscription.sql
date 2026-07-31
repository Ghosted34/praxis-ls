-- ============================================================================
-- TENANT DB — 0473 Web-Push subscriptions. One row per browser/device a user
-- has opted into push on. Stored per-tenant (alongside the notification inbox)
-- for clean tenant isolation. The VAPID identity itself is deploy-wide
-- (shared/push/push.service.js). `endpoint` is globally unique per push service,
-- so it's the natural key; p256dh/auth are the subscription's encryption keys.
-- ============================================================================
CREATE TABLE IF NOT EXISTS push_subscription (
  subscription_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  endpoint        text NOT NULL UNIQUE,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz
);
CREATE INDEX IF NOT EXISTS ix_push_sub_user ON push_subscription (user_id);
