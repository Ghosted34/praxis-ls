/**
 * Smart Comms channel config (MOD-64) — the tenant's OUTBOUND provider setup for
 * WhatsApp (Meta Cloud API) and transactional email (SMTP), set + tested here.
 *
 * Secrets (WhatsApp token, SMTP password) are AES-256-GCM encrypted in the
 * settings integration_secret vault and NEVER read back over HTTP — getConfig
 * returns only presence + last4. Non-secrets (phone_id, SMTP host/user/from)
 * live in the plain `comms` / `email` settings sections. Reads/writes hit the
 * caller's tenant schema via the passed client.
 */
"use strict";

const settings = require("../security/setting/setting.service");
const { getSetting } = require("../../shared/config/settings");
const whatsapp = require("../../services/whatsapp.service");
const email = require("../../services/email.service");
const { config } = require("../../config/env");

const WA_TOKEN_KEY = "whatsapp_token";
const SMTP_PASS_KEY = "email_smtp_pass";

/** Redacted view of both providers — safe for the HTTP surface. */
async function getConfig(client) {
  const wa = (await getSetting(client, "comms", "whatsapp", null)) || {};
  const waToken = await settings.readSecret(client, WA_TOKEN_KEY);
  const em = (await getSetting(client, "email", "default", null)) || {};
  const emPass = await settings.readSecret(client, SMTP_PASS_KEY);
  return {
    whatsapp: {
      phone_id: wa.phone_id || config.META_WA_PHONE_ID || null,
      api_version: wa.api_version || config.META_WA_API_VERSION || "v18.0",
      token_set: Boolean(waToken || config.META_WA_TOKEN),
      token_last4: waToken ? waToken.slice(-4) : null,
    },
    email: {
      smtp_host: em.smtp_host || config.SMTP_HOST || null,
      smtp_port: Number(em.smtp_port || config.SMTP_PORT || 587),
      smtp_user: em.smtp_user || config.SMTP_USER || null,
      from: em.from || null,
      reply_to: em.reply_to || null,
      pass_set: Boolean(emPass || em.smtp_pass || config.SMTP_PASS),
    },
  };
}

async function setWhatsapp(client, { phone_id, api_version, token, actor = {} }) {
  const current = (await getSetting(client, "comms", "whatsapp", null)) || {};
  const next = { ...current };
  if (phone_id !== undefined) next.phone_id = phone_id;
  if (api_version !== undefined) next.api_version = api_version;
  await settings.put(client, { section: "comms", key: "whatsapp", value: next, actor });
  if (token) {
    await settings.put(client, {
      section: settings.SECRET_SECTION,
      key: WA_TOKEN_KEY,
      value: { provider: "meta-whatsapp", key_name: "META_WA_TOKEN", secret: token },
      actor,
    });
  }
  return getConfig(client);
}

async function setEmail(client, { smtp_host, smtp_port, smtp_user, from, reply_to, smtp_pass, actor = {} }) {
  const current = (await getSetting(client, "email", "default", null)) || {};
  const next = { ...current };
  for (const [k, v] of Object.entries({ smtp_host, smtp_port, smtp_user, from, reply_to })) {
    if (v !== undefined) next[k] = v;
  }
  // Never persist the plaintext password in the plain setting — it goes to the vault.
  delete next.smtp_pass;
  await settings.put(client, { section: "email", key: "default", value: next, actor });
  if (smtp_pass) {
    await settings.put(client, {
      section: settings.SECRET_SECTION,
      key: SMTP_PASS_KEY,
      value: { provider: "smtp", key_name: "SMTP_PASS", secret: smtp_pass },
      actor,
    });
  }
  return getConfig(client);
}

const testWhatsapp = (client) => whatsapp.verifyConfig(client);
const testEmail = (client, opts = {}) => email.verifyTransport(client, opts);

/**
 * Mail-setup wizard: verify the sending domain's MX / SPF / DKIM records.
 * `smtpHost` from the tenant's resolved transport sharpens the SPF suggestion
 * (relay presets, include: for the SMTP domain). Public-DNS read only.
 */
async function dnsCheck(client, { domain }) {
  const { checkDomain } = require("../mail/mail/dns-check");
  let smtpHost = null;
  try {
    smtpHost = (await email.resolveMail(client, { purpose: "NOTIFICATIONS" })).smtp_host || null;
  } catch { /* the suggestion is best-effort; the checks themselves don't need it */ }
  return checkDomain(domain, { smtpHost });
}

/**
 * Mail-setup wizard: send a REAL test message through the tenant's transport
 * (verify() only proves the connection — this proves a message actually leaves,
 * the same reasoning as the platform alert-email probe). Failures are
 * classified with smtp-error.map so the wizard can render the matching fix
 * guide; never throws.
 */
async function testSend(client, { to, purpose = "NOTIFICATIONS" }) {
  const { mapSmtpError, isSmtpError } = require("../mail/mail/smtp-error.map");
  try {
    const info = await email.send(client, {
      to,
      purpose,
      // The test must go out the way real mail does, or it tests something the
      // product never does. Passing the send point means the address this
      // proves is the address a bound tenant will actually send from.
      sendPoint: "system.test",
      subject: "Praxis test email — your outbound email is working",
      text:
        "This is a test message from your Praxis tenant.\n\n"
        + "If you received this, your sender address, DNS records and SMTP credentials are configured "
        + "correctly, and outbound email is working.\n\n"
        + "If you expected this but found it in spam, mark it as 'not spam' — that also tells you your "
        + "SPF/DKIM setup is not being honoured by the inbox provider yet.",
      moduleKey: "mail-setup-wizard",
    });
    // A withheld send throws nothing, so "no exception" is not proof a message
    // left. Reporting ok:true here told an admin their outbound mail was working
    // while the sandbox was dropping every message — the one answer this screen
    // must never give. Not `ok`, but not an SMTP failure either: nothing is
    // misconfigured, so the wizard should say what happened, not offer a fix guide.
    if (info && info.suppressed) {
      return {
        ok: false,
        to,
        suppressed: true,
        code: "SANDBOX_SUPPRESSED",
        error: "This tenant is in the sandbox environment, so the test message was withheld rather than sent (PRD §5.5). Run the test in the live environment to prove outbound email.",
      };
    }
    return { ok: true, to, message_id: (info && (info.messageId || info.message_id)) || null };
  } catch (err) {
    const mapped = isSmtpError(err) ? mapSmtpError(err) : null;
    return {
      ok: false,
      to,
      error: mapped ? mapped.message : err.message,
      code: mapped ? mapped.code : undefined,
    };
  }
}

module.exports = { getConfig, setWhatsapp, setEmail, testWhatsapp, testEmail, dnsCheck, testSend };
