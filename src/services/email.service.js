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
const { logger } = require("../config/logger");
const { getSetting } = require("../shared/config/settings");
const settingService = require("../modules/security/setting/setting.service");
const emailRepo = require("./email.repo");
const { mapSmtpError, isSmtpError } = require("../modules/mail/mail/smtp-error.map");
const sendPoints = require("../modules/mail/mail/sendpoint.service");
const origin = require("../modules/mail/mail/origin");
const mailFallback = require("./platform/mail-fallback.service");
const registry = require("./tenant/registry.service");
const entitlement = require("./platform/entitlement.service");

const fmtFrom = (id) => (id.from_name ? `"${id.from_name}" <${id.from_address}>` : id.from_address);

/** Resolve From, SMTP transport and reply-to for a purpose. */
async function resolveMail(client, { purpose = "NOTIFICATIONS", moduleKey = null, sendPoint = null, entityId = null } = {}) {
  let identity = null;
  let settings = {};
  let encPass = null;
  let sendPointWhy = null;
  let sendPointSource = null;
  if (client) {
    // PR-0: a SEND POINT is the most specific answer there is — it names the
    // exact thing being sent ("invoice.issued") rather than a broad purpose, and
    // it can differ per corporate entity so a group sends each company's invoices
    // from that company's address. Asked first; everything below is unchanged and
    // still answers when no binding exists.
    if (sendPoint) {
      const r = await sendPoints.resolve(client, { sendPointKey: sendPoint, entityId });
      sendPointWhy = r.why;
      sendPointSource = r.source;
      if (r.identity) identity = r.identity;
    }
    // WS-E3: a sender BOUND to this section wins; else the legacy purpose-label
    // match (a sender whose own `purpose` equals the key). Then the fallback chain.
    if (!identity) {
      identity = purpose
        ? (await emailRepo.identityForSection(client, purpose)) || (await emailRepo.identityFor(client, purpose))
        : null;
    }
    settings = (await getSetting(client, "email", "default", {})) || {};
    // SMTP password now lives ENCRYPTED in the integration_secret vault; the
    // legacy plaintext settings.smtp_pass is kept only as a back-compat fallback.
    encPass = await settingService.readSecret(client, "email_smtp_pass");
  }
  // ── TIERS: a transport is resolved WHOLE, or not at all ────────────────────
  //
  // A tier answers the entire question — host, port, credentials AND sender —
  // or it does not answer. Nothing is ever borrowed across the boundary.
  //
  // It used to be that host and From fell back together (correctly, for the
  // deliverability reason below) while smtp_user/smtp_pass had a chain of their
  // own: `settings → fallback → env`. Two configurations that occur constantly
  // therefore authenticated to one server with a different server's credentials:
  //
  //   • the tenant saved an SMTP username/password but no host → the Praxis
  //     relay, reached with the TENANT's credentials;
  //   • the tenant has an email_identity carrying smtp_host but never filled in
  //     the `email.default` settings → the TENANT's host, reached with the
  //     PRAXIS RELAY's credentials.
  //
  // Both surface as a 535 the admin cannot act on, because the screen shows the
  // credentials they typed while the rejection came from a host they never
  // named. `smtp_port` split the same way (identity's host, settings' port),
  // and the port is what decides `secure` down in transportFrom.
  //
  // Deliverability is why the tiers exist at all: a tenant-domain From
  // (billing@acme.cm) sent through the deploy relay fails SPF/DKIM/DMARC. A
  // tenant that has not set up their own host has not verified their domain
  // either, so on the fallback transport the From must be the Praxis one. Only
  // once the tenant supplies their own SMTP host do we trust their From.
  const tenantFrom = (identity && fmtFrom(identity)) || settings.from || null;
  const tenantReply = (identity && identity.reply_to) || settings.reply_to || null;
  const idHost = (identity && identity.smtp_host) || null;
  const tenantHost = idHost || settings.smtp_host || null;
  const tenantTier = tenantHost
    ? {
      sender_source: idHost ? "identity" : "settings",
      from: tenantFrom,
      reply_to: tenantReply,
      smtp_host: tenantHost,
      // The port belongs to whichever record supplied the host. Reading it off
      // the other one is how a leftover 465 in settings came to decide `secure`
      // for an identity host that only speaks 587.
      smtp_port: Number((idHost ? identity.smtp_port : settings.smtp_port) || 587),
      // The tenant's ONE SMTP account (vault first; the plaintext setting is the
      // back-compat path). Null is a legitimate answer — a host that accepts
      // unauthenticated relay from this server — and is now honoured as such
      // rather than topped up from the relay's account.
      smtp_user: settings.smtp_user || null,
      smtp_pass: encPass || settings.smtp_pass || null,
    }
    : null;
  // Resolved ONLY when no tenant tier answered: the deploy-wide sender that
  // keeps OTPs, invites, invoices and notifications flowing for tenants who have
  // configured no mail of their own. mail-fallback.service already folds env in
  // underneath the platform setting, so this one object is both lower tiers.
  // `client` being null is the injectable-transport test path — skip the
  // platform round-trip there.
  const fb = client && !tenantHost ? await mailFallback.resolve() : null;
  const fbAddr = fb ? (purpose === "SUPPORT" && fb.support_from ? fb.support_from : fb.from) : null;
  // G-8: give the fallback sender its display name (e.g. `"Praxis" <no-reply@praxisls.com>`).
  const fbFrom = fbAddr ? (fb.from_name ? `"${fb.from_name}" <${fbAddr}>` : fbAddr) : null;
  const fbTier = fb && fb.smtp_host
    ? {
      sender_source: fb.source === "env" ? "env" : "fallback",
      from: fbFrom,
      reply_to: fb.reply_to || null,
      smtp_host: fb.smtp_host,
      smtp_port: Number(fb.smtp_port || 587),
      smtp_user: fb.smtp_user || null,
      smtp_pass: fb.smtp_pass || null,
    }
    : null;
  // Only reachable on the no-client test path; with a client, env already came
  // through mailFallback above and must not be re-entered here as a third
  // source of half a transport.
  const envTier = !client && config.SMTP_HOST
    ? {
      sender_source: "env",
      from: config.MAIL_DEFAULT_FROM || null,
      reply_to: null,
      smtp_host: config.SMTP_HOST,
      smtp_port: Number(config.SMTP_PORT || 587),
      smtp_user: config.SMTP_USER || null,
      smtp_pass: config.SMTP_PASS || null,
    }
    : null;
  const tier = tenantTier || fbTier || envTier;
  // Credentials with nowhere to go are a misconfiguration the admin cannot see:
  // the settings screen shows what they typed, and it is now — correctly — used
  // by nothing. Say so once, rather than presenting it to a host they never
  // named and leaving them to read the 535 as their own password being wrong.
  if (!tenantTier && (settings.smtp_user || encPass || settings.smtp_pass)) {
    logger.warn(
      { sender_source: tier ? tier.sender_source : "none", has_user: Boolean(settings.smtp_user) },
      "[email] tenant SMTP credentials are configured but no SMTP host is — credentials ignored, sending on the fallback transport",
    );
  }
  return {
    from: (tier && tier.from) || config.MAIL_DEFAULT_FROM || ("no-reply@" + (config.MAIL_FALLBACK_DOMAIN || "praxisls.com")),
    reply_to: (tier && tier.reply_to) || null,
    smtp_host: (tier && tier.smtp_host) || null,
    smtp_port: (tier && tier.smtp_port) || Number(config.SMTP_PORT || 587),
    smtp_user: tier ? tier.smtp_user : null,
    smtp_pass: tier ? tier.smtp_pass : null,
    identity_purpose: identity ? identity.purpose : null,
    email_identity_id: identity ? identity.email_identity_id : null,
    module_key: moduleKey,
    // Metadata for logging/UI: which tier answered. Since one tier now answers
    // the whole question, this also names where the credentials came from.
    sender_source: tier ? tier.sender_source : "none",
    // PR-0: which tier chose the sender, and a sentence saying so. "Why did that
    // go out from the wrong address?" is the most-asked email question; this is
    // what lets the admin screen answer it without anyone reading code.
    send_point: sendPoint || null,
    send_point_source: sendPointSource,
    send_point_why: sendPointWhy,
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
 * message-id on success, FAILED with the error on failure, SUPPRESSED when the
 * environment withheld it. When `client` is null (injectable-transport test
 * path) no log is written.
 *
 * RETURNS either nodemailer's `info` (the message left) or, when the send was
 * withheld, `{ suppressed: true, reason, messageId: null, ... }`. A caller that
 * reports an outcome to a human MUST check `suppressed` — it is not an error,
 * so nothing throws, and treating "did not throw" as "delivered" is exactly how
 * a suppressed message came to be reported as sent.
 */
async function send(client, { to, subject, html, text, from, replyTo, attachments = null, purpose = "NOTIFICATIONS", moduleKey = null, entityRef = null, documentVaultId = null, sendPoint = null, entityId = null, actorUserId = null, tenantSlug = null, signature = "auto", language = null, partyLanguage = null }, tx = null) {
  if (!to) throw new Error("email: 'to' is required");

  // G2 — sandbox must not send real client emails (PRD §5.5 [RULE]). The env
  // is read off the CONNECTION (registry tags every pooled client at acquire,
  // and the tenant-context lease re-tags it on schema switches), so both the
  // worker path (withTenantConnection) and the direct paths (req.tenantDb)
  // are covered without threading `env` through every caller. Suppressed =
  // no transport resolved, nothing leaves the server; the send-log records
  // SUPPRESSED so the trail shows what would have gone out.
  //
  // THE RETURN VALUE HAS TO SAY SO, and it did not. `{ suppressed: true }` is
  // truthy and throws nothing, so every caller read it as a successful send:
  // the mail-setup wizard reported `ok: true`, and an enquiry reply settled
  // SENT and moved the enquiry to RESPONDED. Nothing left the server and every
  // surface said it had. Callers now branch on `suppressed`; `messageId` is
  // spelled out as null so anything reading only that field also gets nothing
  // rather than a plausible-looking id.
  //
  // The log row is likewise load-bearing and was silently absent: `SUPPRESSED`
  // was not in email_send_log's status CHECK until 12751, so every one of these
  // inserts raised 23514 into a `.catch(() => {})` and the trail this block
  // exists to leave was never written. The catch now says when that happens —
  // a swallowed write inside the caller's transaction is also what poisons it
  // on the pooled sandbox path, where withTenantConnection holds a BEGIN.
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
      }).catch((err) => {
        logger.error({ err, to, subject }, "[email] could not record a SUPPRESSED send — the sandbox trail is incomplete");
      });
    }
    return {
      suppressed: true,
      reason: "sandbox environment (PRD §5.5)",
      messageId: null,
      env: connEnv,
      to,
      subject: subject || null,
    };
  }

  const cfg = await resolveMail(client, { purpose, moduleKey, sendPoint, entityId });
  if (!tx && !cfg.smtp_host) throw new Error("email: no sender configured (add an email_identity or SMTP settings)");
  const mailer = tx || transportFrom(cfg);
  // G-4: honour a caller-supplied `from` override ONLY when the tenant resolved
  // their OWN host (identity/settings). On the fallback sender the transport is
  // the deploy relay, so sending a tenant-domain From would fail SPF/DKIM/DMARC —
  // the fallback sender wins there (same deliverability rule as resolveMail).
  const useOverride = from && (cfg.sender_source === "identity" || cfg.sender_source === "settings");
  // PR-0 origin stamp. Invisible to the recipient, and the only thing that later
  // lets a message be recognised as ours when we read it back off a mail server —
  // matching on subject and timestamp is guesswork. Also carries WHICH part of
  // the product sent it, so "why did the client get this?" is answerable.
  const originHeaders = origin.buildOriginHeaders({
    tenantSlug, userId: actorUserId, sendPoint: sendPoint || purpose || null,
  });
  // Signatures are a BODY concern. They must not touch resolveMail: when the
  // tenant has no SMTP of their own, the Praxis fallback sender is used and
  // the From falls back with the transport (G-4).
  if (client && signature !== "none") {
    try {
      const baked = await attachSystemSignature(client, {
        html, text, purpose, actorUserId, signature, language, partyLanguage, entityId,
      });
      html = baked.html;
      text = baked.text;
    } catch { /* @silent:storage a missing signature must not fail an OTP */ }
  }
  const payload = {
    from: useOverride ? from : cfg.from, replyTo: replyTo || cfg.reply_to || undefined, to, subject, html, text,
    messageId: origin.generateMessageId(useOverride ? from : cfg.from),
    headers: originHeaders,
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
/**
 * Machine mail (OTP, password reset, notification fan-out) → corporate block,
 * no person. Document mail sent by a named user (invoice, BL) → that user's
 * personal signature over the tenant's BILLING/DOCUMENTS identity.
 *
 * Q17's documented exception: the client has a human to reply to.
 */
async function attachSystemSignature(client, { html, text, purpose, actorUserId, signature, language, partyLanguage, entityId }) {
  const named = signature && signature !== "auto" && signature !== "none"
    ? signature
    : (actorUserId && ["DOCUMENTS", "BILLING"].includes(String(purpose || "").toUpperCase()) ? actorUserId : null);
  const signatures = require("../modules/mail/signature/signature.service");
  const resolved = await signatures.resolveFor(client, {
    userId: named,
    system: !named,
    identity: { purpose, entity_id: entityId },
    language,
    partyLanguage,
  });
  return signatures.bake(html, text, resolved);
}

module.exports = { send, resolveMail, verifyTransport, transportFrom };
