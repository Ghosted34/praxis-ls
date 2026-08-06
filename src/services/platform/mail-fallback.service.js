/**
 * Platform mail fallback — the DEPLOY-WIDE sender used for SYSTEM emails (OTP,
 * invites, invoices, notifications) when a tenant has not configured their own
 * SMTP / sender identity. Configured + live-tested in the Platform Console
 * (Integrations → Mail fallback); these are the second of the two email
 * configs (see doc/EMAIL_TWO_CONFIGS.md):
 *
 *   1. Per-tenant SYSTEM email  — email_identity / `email.default` setting,
 *      with THIS fallback underneath so tenants who haven't pointed their DNS
 *      at us never lose OTP / invoice / notification mail.
 *   2. Per-user MAILBOX          — email_connection (their company-domain
 *      professional address, inbound + outbound), handled by src/modules/mail.
 *
 * The fallback's SMTP password is AES-256-GCM encrypted at rest in the
 * platform_setting vault (`mail.fallback`, secret) like S3/Geoapify/VAPID.
 * Resolution order: platform setting → env (SMTP_* / MAIL_*). NEVER throws —
 * a missing or unreachable platform DB just means "use env".
 */
"use strict";

const platformSettings = require("./settings.service");
const { config } = require("../../config/env");

const SECTION = "mail";
const KEY = "fallback";

/** Last-resort env-derived sender, used when the platform setting is absent. */
function envDefaults() {
  const domain = config.MAIL_FALLBACK_DOMAIN || "praxisls.com";
  return {
    from: config.MAIL_DEFAULT_FROM || `no-reply@${domain}`,
    support_from: config.MAIL_SUPPORT_FROM || `support@${domain}`,
    from_name: config.MAIL_FALLBACK_FROM_NAME || "Praxis",
    reply_to: null,
    fallback_domain: domain,
    smtp_host: config.SMTP_HOST || null,
    smtp_port: Number(config.SMTP_PORT || 587),
    smtp_user: config.SMTP_USER || null,
    smtp_pass: config.SMTP_PASS || null,
    source: "env",
  };
}

/**
 * Resolve the deploy-wide fallback sender. `value` holds the non-secret config
 * (from/from_name/support_from/reply_to/fallback_domain/smtp_host/port/user);
 * the decrypted SMTP password is the encrypted `secret`. Falls back to env.
 */
async function resolve() {
  try {
    const row = await platformSettings.resolve(SECTION, KEY);
    if (!row) return envDefaults();
    const v = row.value || {};
    const d = envDefaults();
    const domain = v.fallback_domain || d.fallback_domain;
    return {
      from: v.from || d.from,
      support_from: v.support_from || d.support_from,
      from_name: v.from_name || d.from_name,
      reply_to: v.reply_to || null,
      fallback_domain: domain,
      smtp_host: v.smtp_host || d.smtp_host,
      smtp_port: Number(v.smtp_port || d.smtp_port),
      smtp_user: v.smtp_user || d.smtp_user,
      smtp_pass: row.secret || d.smtp_pass,
      source: "platform",
    };
  } catch {
    // Platform DB unreachable / not migrated — env remains the safe default.
    return envDefaults();
  }
}

module.exports = { resolve, SECTION, KEY, envDefaults };
