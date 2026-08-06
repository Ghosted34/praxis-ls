-- ============================================================================
-- PLATFORM DB — 0091 system-email fallback sender (`mail.fallback`)
--
-- The deploy-wide sender used for SYSTEM emails (OTP, invites, invoices,
-- notifications) when a tenant has not configured their own mail — the fallback
-- so tenants who haven't pointed their DNS at us never fail to receive system
-- mail. This is the second email config, distinct from each user's MAILBOX
-- (email_connection). See doc/EMAIL_TWO_CONFIGS.md.
--
-- Stored like the other deploy-wide credentials (0050): non-secret config in
-- `value`, the SMTP password AES-256-GCM encrypted in `secret_enc` (set later
-- in the Platform Console → Integrations → Mail fallback; blank here means the
-- runtime falls back to the env SMTP_* vars). Administered + live-tested there;
-- probes registered in src/services/platform/settings.service.js SPEC.
--
-- Idempotent: ON CONFLICT ... DO NOTHING — an operator who already set real
-- creds keeps them on re-run.
-- ============================================================================

INSERT INTO platform.platform_setting (section, key, value)
VALUES ('mail', 'fallback', '{
  "from":            "no-reply@praxisls.com",
  "from_name":       "Praxis",
  "support_from":    "support@praxisls.com",
  "reply_to":        null,
  "fallback_domain": "praxisls.com",
  "smtp_host":       "",
  "smtp_port":       587,
  "smtp_user":       ""
}'::jsonb)
ON CONFLICT (section, key) DO NOTHING;
