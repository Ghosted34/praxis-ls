/**
 * Email service — per-tenant, PER-PURPOSE sender (nodemailer, lazily required).
 *
 * There is NO single generic sender. Each sending purpose (BILLING / DOCUMENTS /
 * NOTIFICATIONS / SUPPORT) has its OWN verified identity in `email_identity`
 * (From address + name + domain + SMTP host, SPF/DKIM/DMARC). A module declares
 * its `purpose` when sending; the identity resolves the From + transport host.
 *
 * Resolution (DB-first, env-fallback per BUILD_CONVENTIONS §7):
 *   From + host  ← email_identity(purpose) → settings "email".default → env
 *   auth creds   ← settings "email".default (smtp_user/pass) → env SMTP_*
 * `send` needs the tenant client to resolve these.
 */
"use strict";

const { config } = require("../config/env");
const { getSetting } = require("../shared/config/settings");
const emailRepo = require("./email.repo");

const fmtFrom = (id) => (id.from_name ? `"${id.from_name}" <${id.from_address}>` : id.from_address);

/** Resolve From, SMTP transport and reply-to for a purpose. */
async function resolveMail(client, { purpose = "NOTIFICATIONS", moduleKey = null } = {}) {
  let identity = null;
  let settings = {};
  if (client) {
    identity = purpose ? await emailRepo.identityFor(client, purpose) : null;
    settings = (await getSetting(client, "email", "default", {})) || {};
  }
  return {
    from: (identity && fmtFrom(identity)) || settings.from || config.MAIL_DEFAULT_FROM || ("no-reply@" + (config.MAIL_FALLBACK_DOMAIN || "praxisls.com")),
    reply_to: (identity && identity.reply_to) || settings.reply_to || null,
    smtp_host: (identity && identity.smtp_host) || settings.smtp_host || config.SMTP_HOST || null,
    smtp_port: Number((identity && identity.smtp_port) || settings.smtp_port || config.SMTP_PORT || 587),
    smtp_user: settings.smtp_user || config.SMTP_USER || null,
    smtp_pass: settings.smtp_pass || config.SMTP_PASS || null,
    identity_purpose: identity ? identity.purpose : null,
    module_key: moduleKey,
  };
}

function transportFrom(cfg) {
  // eslint-disable-next-line global-require
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
 * `tx` is an injectable transport for tests.
 */
async function send(client, { to, subject, html, text, from, replyTo, purpose = "NOTIFICATIONS", moduleKey = null }, tx = null) {
  if (!to) throw new Error("email: 'to' is required");
  const cfg = await resolveMail(client, { purpose, moduleKey });
  if (!tx && !cfg.smtp_host) throw new Error("email: no sender configured (add an email_identity or SMTP settings)");
  const mailer = tx || transportFrom(cfg);
  return mailer.sendMail({ from: from || cfg.from, replyTo: replyTo || cfg.reply_to || undefined, to, subject, html, text });
}

module.exports = { send, resolveMail };
