/**
 * Deploy-wide sender for PLATFORM email — mail that belongs to no tenant.
 *
 * WHY THIS HAD TO EXIST
 *
 *   `services/email.service.js` is the only mailer in the codebase and it is
 *   tenant-scoped by design: `send(client, …)` needs a tenant connection to
 *   resolve an `email_identity`, and `resolveMail()` only consults the platform
 *   fallback when a `client` is present (`client && !ownHost ? … : null`). Pass
 *   null and you get no identity, no fallback, no host, and it throws
 *   "no sender configured".
 *
 *   Escalation email (spec §5.3) has no tenant. A fatal error in the host
 *   resolver, the registry, or boot itself — the class that takes the whole
 *   deployment down and most needs to page someone — happens before any tenant
 *   is known, and `error_escalation_rule.tenant_id` is nullable precisely to
 *   cover it. So the one alert path that matters most had no sender it could use.
 *
 * WHAT WAS ACTUALLY HAPPENING BEFORE THIS
 *
 *   `error-escalation.service.deliver()` called:
 *
 *       enqueue("email-send", { to, subject, text })
 *
 *   Three faults in one line, each sufficient on its own:
 *
 *     1. THE QUEUE IS CALLED "email". `workers.js` registers
 *        `{ name: "email", handler: require("./handlers/email-send") }` — the
 *        HANDLER FILE is email-send.js, the QUEUE is "email". Jobs went to a
 *        queue with no worker attached and sat in Redis forever.
 *     2. WRONG ARITY. `enqueue(name, jobName, data, opts)` — the payload was
 *        passed where the job NAME goes, so `data` was undefined.
 *     3. EVEN CORRECTED, IT COULD NOT WORK. handlers/email-send.js opens with
 *        `if (!tenantMeta) throw new Error("email job needs tenantMeta")`.
 *        Platform escalation has no tenantMeta, by definition.
 *
 *   And the failure was SILENT-POSITIVE, which is the worst shape available:
 *   `enqueue` resolved, so `deliver()` recorded `taken.email = <recipients>`
 *   into `platform.error_escalation_log`. The audit trail said the email was
 *   sent. "Why was I not paged at 3am" had an answer, and the answer was wrong.
 *
 * HOW THIS RELATES TO THE TWO DOCUMENTED EMAIL CONFIGS
 *
 *   doc/EMAIL_TWO_CONFIGS.md defines exactly two: (1) SYSTEM email, tenant
 *   identity with a Praxis fallback underneath, and (2) per-user MAILBOX. This
 *   module does NOT add a third configuration — that would be the clash worth
 *   avoiding. It is a second CONSUMER of config (1)'s bottom tier: the same
 *   `mail.fallback` platform setting, the same `no-reply@` sender, the same
 *   deploy-wide SMTP, resolved by the same `mail-fallback.service`.
 *
 *   The transport is built by `email.service.transportFrom` rather than
 *   reconstructed here, so there is ONE nodemailer configuration in the
 *   codebase. Copying it would drift on the first TLS change, and the symptom
 *   of that drift is mail that sends on one path and bounces on the other.
 *
 *   It also honours the same deliverability rule as `email.service` (G-4): no
 *   caller may override `from`. On the fallback relay a foreign From fails
 *   SPF/DKIM/DMARC, so the fallback sender always wins. Here that is enforced by
 *   simply not accepting the parameter.
 *
 * SCOPE — deliberately small
 *
 *   No log table, no retry queue, no templating. Escalation email is a
 *   notification, not a business document: `email_send_log` is a TENANT table
 *   this has no connection to (and writing platform mail into one tenant's log
 *   would be worse than not logging it), and a BullMQ retry on an alert that
 *   already repeats on `repeat_interval_minutes` would multiply the noise. The
 *   send is awaited inline by the escalation evaluator, which already isolates
 *   each channel's failures from the others. The durable record of an escalation
 *   send is its `platform.error_escalation_log` row.
 */

"use strict";

const { logger } = require("../../config/logger");
const mailFallback = require("./mail-fallback.service");

/**
 * Reuses the tenant mailer's transport builder — see the header. Required
 * lazily so importing this module never pulls in nodemailer or opens a socket.
 */
function transportFrom(cfg) {

  return require("../email.service").transportFrom(cfg);
}

/**
 * Send one platform email through the deploy-wide fallback sender.
 *
 * Resolves From and SMTP from the `mail.fallback` platform setting, falling
 * back to env — the same order `email.service` uses for a tenant with no
 * identity of its own, so a deployment configures its sender in exactly one
 * place (Console → Integrations → Mail fallback).
 *
 * @param {object} msg
 * @param {string[]|string} msg.to
 * @param {string} msg.subject
 * @param {string} msg.text
 * @param {string} [msg.html]
 * @param {object} [tx] injectable transport, for tests
 * @returns {Promise<{ok: boolean, reason?: string, message_id?: string}>}
 *   NEVER THROWS. The caller is an alerting path: a dead SMTP relay must not
 *   also cancel the in-house notification and the webhook for the same incident.
 *   `ok:false` with a reason is the honest result, and it is what gets recorded
 *   in error_escalation_log instead of a fabricated success.
 */
async function send({ to, subject, text, html }, tx = null) {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (!recipients.length) return { ok: false, reason: "no_recipients" };

  let cfg;
  try {
    cfg = await mailFallback.resolve();
  } catch (err) {
    return { ok: false, reason: `config_unavailable: ${err.message}` };
  }

  // The common case on a fresh deployment: nobody has configured the fallback
  // sender yet. Say so plainly rather than reporting a send that did not happen
  // — an operator who sees `no_smtp_configured` in the escalation log knows what
  // to do; one who sees a green tick does not know there is anything to do.
  if (!tx && !cfg.smtp_host) return { ok: false, reason: "no_smtp_configured" };

  const from = cfg.from_name ? `"${cfg.from_name}" <${cfg.from}>` : cfg.from;

  try {
    const info = await (tx || transportFrom(cfg)).sendMail({
      from,
      to: recipients.join(", "),
      subject,
      text,
      ...(html ? { html } : {}),
      ...(cfg.reply_to ? { replyTo: cfg.reply_to } : {}),
    });
    return { ok: true, message_id: info && info.messageId, from, recipients };
  } catch (err) {
    logger.warn({ err, recipients: recipients.length }, "[platform-mail] send failed");
    return { ok: false, reason: String(err.message || err).slice(0, 200) };
  }
}

module.exports = { send, transportFrom };
