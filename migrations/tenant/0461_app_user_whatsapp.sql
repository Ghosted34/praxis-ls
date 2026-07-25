-- ============================================================================
-- 0461 — app_user WhatsApp notification target
-- The E.164 number the notification dispatcher sends WhatsApp alerts to when a
-- user opts into the WhatsApp channel (shared.notification_preferences). NULL =
-- the WhatsApp channel silently no-ops for that user. Idempotent.
-- ============================================================================

ALTER TABLE app_user ADD COLUMN IF NOT EXISTS whatsapp_number text;
