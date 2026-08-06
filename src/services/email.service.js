/**
 * Email service — per-tenant, PER-PURPOSE SYSTEM-EMAIL sender (nodemailer).
 *
 * There is NO single generic sender. Each sending purpose (BILLING / DOCUMENTS /
 * NOTIFICATIONS / SUPPORT) has its OWN verified identity in `email_identity`
 * (From address + name + domain + SMTP host, SPF/DKIM/DMARC). A module declares
 * its `purpose` when sending; the identity resolves the From + transport host.
 *
 * Resolution (tenant-first, platform-fallback, env last — BUILD_CONVENTIONS §7):
 *   From + host  ← email_identity(purpose) → settings "email".default
 *                → PLATFORM mail.fallback (deploy-wide sender, see
 *                  src/services/platform/mail-fallback.service.js) → env
 *   auth creds   ← settings "email".default (smtp_user/pass) → fallback → env
 *
 * Why a fallback: tenants who have NOT configured their own mail (no identity,
 * no SMTP, DNS not pointed at us) must still receive OTPs, invites, invoices and
 * notifications. Those SYSTEM emails fall back to a Praxis-owned sender
 * (no-reply@praxisls.com / support@praxisls.com) sent through the deploy-wide
 * SMTP, so nothing silently fails. This is distinct from the second config —
 * the per-user MAILBOX (their company-domain professional address, inbound +
 * outbound) which lives in email_connection and is handled by src/modules/mail.
 * See doc/EMAIL_TWO_CONFIGS.md.
 *
 * `send` needs the tenant client to resolve these (the fallback itself is
 * platform-wide and independent of the tenant client).
 */
"use strict";

const { config } = require("../config/env");
const { getSetting } = require("../shared/config/settings");
const settingService = require("../modules/security/setting/setting.service");
const emailRepo = require("./email.repo");
const mailFallback = require("./platform/mail-fallback.service");

const fmtFrom = (id) => (id.from_name ? `"${id.from_name}" <${id.from_address}>` : id.from_address);

/** Resolve From, SMTP transport and reply-to for a purpose. */
async function resolveMail(client, { purpose = "NOTIFICATIONS", moduleKey = null } = {}) {
  let identity = null;
  let settings = {};
  let encPass = null;
  if (client) {
    identity = purpose ? await emailRepo.identityFor(client, purpose) : null;
    settings = (await getSetting(client, "email", "default", {})) || {};
    // SMTP password now lives ENCRYPTED in the integration_secret vault; the
    // legacy plaintext settings.smtp_pass is kept only as a back-compat fallback.
    encPass = await settingService.readSecret(client, "email_smtp_pass");
  }
  // Tenant's own transport wins. When the tenant has configured NO SMTP host
  // (no email_identity / email setting), resolve the deploy-wide FALLBACK
  // sender (platform `mail.fallback` → env) so system emails still go out from
  // a Praxis-owned address instead of failing. `client` being null is the
  // injectable-transport test path — skip the platform round-trip there.
  //
  // Deliverability: when we fall back on TRANSPORT we also fall back on the
  // SENDER. Sending a tenant-domain From (e.g. billing@acme.cm) through the
  // deploy SMTP would fail SPF/DKIM/DMARC and bounce — a tenant that hasn't set
  // up their own host hasn't verified their domain either, so the From must be
  // the Praxis one. Only once the tenant supplies their own SMTP host do we
  // trust their From/identity.
  const tenantFrom = (identity && fmtFrom(identity)) || settings.from || null;
  const tenantReply = (identity && identity.reply_to) || settings.reply_to || null;
  const ownHost = (identity && identity.smtp_host) || settings.smtp_host;
  const fb = client && !ownHost ? await mailFallback.resolve() : null;
  const fbAddr = fb ? (purpose === "SUPPORT" && fb.support_from ? fb.support_from : fb.from) : null;
  // G-8: give the fallback sender its display name (e.g. `"Praxis" <no-reply@praxisls.com>`).
  const fbFrom = fbAddr ? (fb.from_name ? `"${fb.from_name}" <${fbAddr}>` : fbAddr) : null;
  return {
    from: (ownHost && tenantFrom) || fbFrom || config.MAIL_DEFAULT_FROM || ("no-reply@" + (config.MAIL_FALLBACK_DOMAIN || "praxisls.com")),
    reply_to: (ownHost && tenantReply) || (fb && fb.reply_to) || null,
    smtp_host: ownHost || (fb && fb.smtp_host) || config.SMTP_HOST || null,
    smtp_port: Number((identity && identity.smtp_port) || settings.smtp_port || (fb && fb.smtp_port) || config.SMTP_PORT || 587),
    smtp_user: settings.smtp_user || (fb && fb.smtp_user) || config.SMTP_USER || null,
    smtp_pass: encPass || settings.smtp_pass || (fb && fb.smtp_pass) || config.SMTP_PASS || null,
    identity_purpose: identity ? identity.purpose : null,
    email_identity_id: identity ? identity.email_identity_id : null,
    module_key: moduleKey,
    // Metadata for logging/UI: which sender path won, and the fallback's detail.
    sender_source: ownHost ? (identity ? "identity" : "settings") : fb ? "fallback" : "env",
    fallback: fb ? { from: fbFrom || fb.from, domain: fb.fallback_domain, source: fb.source } : null,
  };
}

function transportFrom(cfg) {
   
  const nodemailer = require("nodemailer");
  return nodemailer.createTransport({
    host: cfg.smtp_host,
    port: cfg.smtp_port,
    secure: cfg.smtp_port === 465,
    auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_pass } : undefined,
  });
}

/**
 * Send one message from the given purpose's verified identity. `client` is the
 * tenant connection; `purpose` selects the sender; `from`/`replyTo` override;
 * `entityRef`/`documentVaultId` are recorded on the send-log row (the source
 * document emailed / its vault copy); `tx` is an injectable transport for tests.
 *
 * Every attempt is recorded to email_send_log (G-1): SENT with the provider
 * message-id on success, FAILED with the error on failure. When `client` is null
 * (injectable-transport test path) no log is written.
 */
async function send(client, { to, subject, html, text, from, replyTo, attachments = null, purpose = "NOTIFICATIONS", moduleKey = null, entityRef = null, documentVaultId = null }, tx = null) {
  if (!to) throw new Error("email: 'to' is required");
  const cfg = await resolveMail(client, { purpose, moduleKey });
  if (!tx && !cfg.smtp_host) throw new Error("email: no sender configured (add an email_identity or SMTP settings)");
  const mailer = tx || transportFrom(cfg);
  // G-4: honour a caller-supplied `from` override ONLY when the tenant resolved
  // their OWN host (identity/settings). On the fallback sender the transport is
  // the deploy relay, so sending a tenant-domain From would fail SPF/DKIM/DMARC —
  // the fallback sender wins there (same deliverability rule as resolveMail).
  const useOverride = from && (cfg.sender_source === "identity" || cfg.sender_source === "settings");
  const payload = {
    from: useOverride ? from : cfg.from, replyTo: replyTo || cfg.reply_to || undefined, to, subject, html, text,
    ...(attachments && attachments.length ? { attachments } : {}),
  };
  const logBase = {
    email_identity_id: cfg.email_identity_id,
    to_address: Array.isArray(to) ? to.join(", ") : to,
    subject: subject || null,
    entity_ref: entityRef || null,
    document_vault_id: documentVaultId || null,
  };
  try {
    const info = await mailer.sendMail(payload);
    if (client) {
      await emailRepo.recordSend(client, {
        ...logBase,
        status: "SENT",
        provider_message_id: (info && (info.messageId || info.message_id)) || null,
        error: null,
      }).catch(() => { /* log write is best-effort, never masks a sent mail */ });
    }
    return info;
  } catch (err) {
    if (client) {
      await emailRepo.recordSend(client, { ...logBase, status: "FAILED", provider_message_id: null, error: err && err.message })
        .catch(() => { /* log write is best-effort */ });
    }
    throw err;
  }
}

/**
 * Live SMTP connectivity + auth check for a purpose's resolved transport
 * (nodemailer verify() — opens the connection, runs EHLO/AUTH, sends nothing).
 * Returns { ok, ... }; never throws, so Smart Comms can render a clean result.
 */
async function verifyTransport(client, { purpose = "NOTIFICATIONS" } = {}) {
  const cfg = await resolveMail(client, { purpose });
  if (!cfg.smtp_host) return { ok: false, error: "no SMTP host configured (add an email_identity or SMTP settings)" };
  try {
    await transportFrom(cfg).verify();
    return { ok: true, smtp_host: cfg.smtp_host, smtp_port: cfg.smtp_port, from: cfg.from };
  } catch (err) {
    return { ok: false, smtp_host: cfg.smtp_host, smtp_port: cfg.smtp_port, error: err.message };
  }
}

module.exports = { send, resolveMail, verifyTransport };
