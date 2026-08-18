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
const { mapSmtpError, isSmtpError } = require("../modules/mail/smtp-error.map");
const mailFallback = require("./platform/mail-fallback.service");
const registry = require("./tenant/registry.service");
const entitlement = require("./platform/entitlement.service");

const fmtFrom = (id) => (id.from_name ? `"${id.from_name}" <${id.from_address}>` : id.from_address);

/** Resolve From, SMTP transport and reply-to for a purpose. */
async function resolveMail(client, { purpose = "NOTIFICATIONS", moduleKey = null } = {}) {
  let identity = null;
  let settings = {};
  let encPass = null;
  if (client) {
    // WS-E3: a sender BOUND to this section wins; else the legacy purpose-label
    // match (a sender whose own `purpose` equals the key). Then the fallback chain.
    identity = purpose
      ? (await emailRepo.identityForSection(client, purpose)) || (await emailRepo.identityFor(client, purpose))
      : null;
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

  // G2 — sandbox must not send real client emails (PRD §5.5 [RULE]). The env
  // is read off the CONNECTION (registry tags every pooled client at acquire,
  // and the tenant-context lease re-tags it on schema switches), so both the
  // worker path (withTenantConnection) and the direct paths (req.tenantDb)
  // are covered without threading `env` through every caller. Suppressed =
  // no transport resolved, nothing leaves the server; the send-log records
  // SUPPRESSED so the trail shows what would have gone out.
  const connEnv = client ? client[Symbol.for("praxis.conn.env")] : null;
  if (connEnv === "sandbox") {
    if (client) {
      await emailRepo.recordSend(client, {
        email_identity_id: null,
        to_address: Array.isArray(to) ? to.join(", ") : to,
        subject: subject || null,
        entity_ref: entityRef || null,
        document_vault_id: documentVaultId || null,
        status: "SUPPRESSED",
        error: "suppressed: sandbox environment (PRD §5.5)",
      }).catch(() => { /* log write is best-effort */ });
    }
    return { suppressed: true, env: connEnv, to, subject: subject || null };
  }

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
      // WS-S3 — email volume is WARN-ONLY, and after the send, not before.
      //
      // WHY IT NEVER BLOCKS, even if an operator marks the entitlement `hard`.
      //   This one sender carries invoices, password resets and OTPs. Refusing a
      //   send because a tenant is over an email allowance locks users out of
      //   their own account and breaks the billing that would collect on the
      //   overage — a limit that defends revenue by preventing it. Overage on
      //   email is a conversation; it is not a thing worth an outage for. The
      //   `neverBlock` flag says that explicitly rather than relying on nobody
      //   ever ticking the box.
      //
      // WHY AFTER THE SEND.
      //   A pre-send check would put a platform-database round trip in front of
      //   every message. Since the answer can never stop the send, doing it
      //   first buys nothing and costs latency on the hottest path here.
      //
      // Fire-and-forget, and un-awaited on purpose: mail delivery must never
      // wait on telemetry. `guard` reads a short-TTL cache and the alert is
      // deduplicated to once per tenant/metric/month, so the steady state costs
      // no platform query and no alert — which it must, because this runs on
      // every invoice, reset and OTP the system sends.
      //
      // Wrapped in try/catch as well as `.catch()`: the `.catch` only covers a
      // REJECTED promise, and a synchronous throw here — a partially stubbed
      // registry in a test double, a module load ordering problem — would
      // escape it and fail a mail that has already been delivered. Nothing in
      // this block may turn a sent message into an error.
      try {
        entitlement
          .guard(registry.tenantIdOf?.(client), "emails_month", {
            additional: 1,
            action: `email.send:${purpose}`,
            neverBlock: true,
          })
          ?.catch(() => { /* warn-only by definition; never touches the send */ });
      } catch { /* @silent:storage|parse|teardown — telemetry must never mask a successful send */ }
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
    // Classify SMTP verdicts (550 sender verify, 535 auth, 5xx rejections) so
    // the UI can pick the matching fix guide; plain network failures keep their
    // raw message — "could not send" would hide the actual getaddrinfo reason.
    if (isSmtpError(err)) {
      const mapped = mapSmtpError(err);
      return { ok: false, smtp_host: cfg.smtp_host, smtp_port: cfg.smtp_port, error: mapped.message, code: mapped.code };
    }
    return { ok: false, smtp_host: cfg.smtp_host, smtp_port: cfg.smtp_port, error: err.message };
  }
}

/**
 * `transportFrom` is exported so `services/platform/mail.service.js` can build
 * the SAME nodemailer transport for platform mail (escalation alerts), which
 * has no tenant `client` and therefore cannot come through `send()` above.
 *
 * Exported rather than copied deliberately: TLS options, the `secure` port rule
 * and the auth shape are deliverability-critical, and two copies drift silently
 * — the first symptom being mail that sends in one path and bounces in the other.
 */
module.exports = { send, resolveMail, verifyTransport, transportFrom };
