/**
 * Email service — per-tenant SMTP send (nodemailer, lazily required). SMTP creds
 * come from tenant settings (section "email"), NOT .env (BUILD_CONVENTIONS §7):
 *   email.smtp_host, email.smtp_port, email.smtp_user, email.smtp_pass,
 *   email.from (or email.from_domain). Sending runs from the `email` worker with
 *   retry/backoff. `send` needs the tenant client to resolve those settings.
 */
"use strict";

const { getSection } = require("../shared/config/settings");

function transportFrom(cfg) {
  // eslint-disable-next-line global-require
  const nodemailer = require("nodemailer");
  const port = Number(cfg.smtp_port) || 587;
  return nodemailer.createTransport({
    host: cfg.smtp_host,
    port,
    secure: port === 465,
    auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_pass } : undefined,
  });
}

const fromOf = (cfg) => cfg.from || ("no-reply@" + (cfg.from_domain || "praxisls.com"));

/**
 * Send one message using the tenant's configured SMTP. `client` is the tenant
 * connection; `tx` is an injectable transport for tests.
 */
async function send(client, { to, subject, html, text, from }, tx = null) {
  if (!to) throw new Error("email: 'to' is required");
  let cfg = {};
  if (client) cfg = await getSection(client, "email");
  if (!tx && !cfg.smtp_host) throw new Error("email: no SMTP configured (set section 'email' in Settings)");
  const mailer = tx || transportFrom(cfg);
  return mailer.sendMail({ from: from || fromOf(cfg), to, subject, html, text });
}

module.exports = { send };
