/**
 * Shared SMTP-error classifier — one map for every outbound-mail path.
 *
 * A raw nodemailer/SMTP rejection must surface as a clean, actionable AppError
 * so the UI can show a fix guide keyed on `code`, not a leaked stack. The same
 * classifier is used by:
 *   - mail.service.js          (tenant sends / replies via mailbox connections)
 *   - providers/imapSmtp.provider.js (connection test, SMTP stage)
 *   - services/email.service.js (system-email transport + smartcomm test)
 *   - services/platform/settings.probes.js (deploy-wide Mail-fallback probe)
 *
 * Keeping it in ONE file means `SMTP_SENDER_REJECTED` means the same thing in
 * the tenant console, the mailbox page and the platform console — the fix guide
 * is rendered from the code alone, so the two UIs cannot drift apart.
 */
"use strict";
const { AppError } = require("../../utils/errors");

/**
 * Turn a raw nodemailer/SMTP rejection into a clean, actionable AppError.
 * `550 Sender verify failed` in particular is a remote-server verdict on the
 * FROM address (its domain needs a real mailbox + MX/SPF/DKIM, and the From
 * must match the authenticated account); we say so rather than leaking a
 * nodemailer stack.
 */
function mapSmtpError(err) {
  if (err instanceof AppError) return err;
  const code = err && err.responseCode; // SMTP reply code, e.g. 550, 535
  const raw = String((err && err.response) || (err && err.message) || err || "");
  if (/sender verify failed/i.test(raw) || (code === 550 && /verif/i.test(raw))) {
    return new AppError(
      "SMTP_SENDER_REJECTED",
      "The mail server rejected the sender address (550 Sender verify failed). "
        + "Check that the From address is a real mailbox on a domain with valid "
        + "MX/SPF/DKIM records and that it matches the authenticated SMTP account.",
      502,
      { smtp_code: code || null, smtp_response: raw.slice(0, 300) },
    );
  }
  if (err && err.code === "EAUTH") {
    return new AppError("SMTP_AUTH_FAILED", "The mail server rejected the SMTP credentials for this mailbox.", 502, { smtp_code: code || null });
  }
  if (code >= 500 || (err && err.code === "EENVELOPE")) {
    return new AppError("SMTP_SEND_REJECTED", `The mail server rejected the message${code ? ` (${code})` : ""}.`, 502, { smtp_code: code || null, smtp_response: raw.slice(0, 300) });
  }
  return new AppError("SMTP_SEND_FAILED", "Could not send the message through the mail server.", 502, { reason: raw.slice(0, 300) });
}

/**
 * Best-effort code from a message string alone, for paths where the original
 * error object is gone (probes, older adapters, logs). Mirrors mapSmtpError's
 * sniffing so the UI can still pick the right guide.
 */
function smtpCodeFromMessage(msg) {
  const text = String(msg || "");
  if (/sender verify failed/i.test(text) || (/550/.test(text) && /verif/i.test(text))) return "SMTP_SENDER_REJECTED";
  if (/535/.test(text) || /eauth|auth.*(failed|invalid|denied)/i.test(text)) return "SMTP_AUTH_FAILED";
  if (/\b5\d\d\b/.test(text) || /rejected|refused|denied/i.test(text)) return "SMTP_SEND_REJECTED";
  return null;
}

/** True when the error looks like an SMTP verdict rather than e.g. an IMAP one. */
function isSmtpError(err) {
  if (!err) return false;
  return !!(err.responseCode || err.code === "EAUTH" || err.code === "EENVELOPE" || smtpCodeFromMessage(err.response || err.message));
}

module.exports = { mapSmtpError, smtpCodeFromMessage, isSmtpError };
