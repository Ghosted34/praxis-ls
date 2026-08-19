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
 * Sender-verify / relay-denied verdicts are mailbox-config faults on the
 * sender's own server — not Praxis 5xx — so they map to 422 SENDER_NOT_AUTHORIZED
 * and stay out of the server-error monitor. Auth and generic 5xx stay 502.
 */
"use strict";
const { AppError } = require("../../../utils/errors");

const SENDER_SNIFF =
  /sender verif|valid sender|not allowed to send|not authori[sz]ed|relay(ing)? denied|relay access denied|from address|must be authenticated|authentication required/;

function isSenderRejected(code, raw) {
  const lc = String(raw || "").toLowerCase();
  return (
    code === 550 ||
    code === 553 ||
    code === 554 ||
    SENDER_SNIFF.test(lc)
  );
}

/**
 * Turn a raw nodemailer/SMTP rejection into a clean, actionable AppError.
 * `550 Sender verify failed` in particular is a remote-server verdict on the
 * FROM address (its domain needs a real mailbox + MX/SPF/DKIM, and the From
 * must match the authenticated account).
 */
function mapSmtpError(err) {
  if (err instanceof AppError) return err;
  const code = err && err.responseCode; // SMTP reply code, e.g. 550, 535
  const raw = String((err && err.response) || (err && err.message) || err || "");
  if (isSenderRejected(code, raw)) {
    return new AppError(
      "SENDER_NOT_AUTHORIZED",
      "The mail server rejected the sender address. "
        + "The \"From\" address must be a real mailbox on a domain with valid "
        + "MX/SPF/DKIM records and usually has to match the login you connected with. "
        + "This is the mailbox's SMTP setup — not Praxis.",
      422,
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
  if (isSenderRejected(null, text) || /sender verify failed/i.test(text) || (/550/.test(text) && /verif/i.test(text))) {
    return "SENDER_NOT_AUTHORIZED";
  }
  if (/535/.test(text) || /eauth|auth.*(failed|invalid|denied)/i.test(text)) return "SMTP_AUTH_FAILED";
  if (/\b5\d\d\b/.test(text) || /rejected|refused|denied/i.test(text)) return "SMTP_SEND_REJECTED";
  return null;
}

/** True when the error looks like an SMTP verdict rather than e.g. an IMAP one. */
function isSmtpError(err) {
  if (!err) return false;
  return !!(err.responseCode || err.code === "EAUTH" || err.code === "EENVELOPE" || smtpCodeFromMessage(err.response || err.message));
}

module.exports = { mapSmtpError, smtpCodeFromMessage, isSmtpError, isSenderRejected };
