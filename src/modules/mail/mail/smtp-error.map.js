/**
 * Shared SMTP-error classifier — one map for every outbound-mail path.
 *
 * A raw nodemailer/SMTP rejection must surface as a clean, actionable AppError
 * so the UI can show a fix guide keyed on `code`, not a leaked stack.
 *
 * Classification is by EVIDENCE, not SMTP family. A bare 550 is "mailbox
 * unavailable" in RFC 5321 — user-unknown, policy, AND sender-verify all use
 * it. Treating every 550 as "fix your From address" sends the operator to the
 * wrong panel and marks a retryable/recipient failure permanent.
 *
 * Order: auth → sender → recipient → transient → other 5xx.
 */
"use strict";
const { AppError } = require("../../../utils/errors");

const SENDER_SNIFF =
  /sender verif|valid sender|not allowed to send|relay(ing)? denied|relay access denied|from address must|from address.*(not|must).*(match|authenticat)|sender address rejected|mail from.*(denied|rejected)/i;

const RECIPIENT_SNIFF =
  /user unknown|unknown user|no such user|mailbox (unavailable|not found)|recipient.*(reject|unknown|not found)|invalid recipient|550 5\.1\.1|551 5\.1\.1/i;

const AUTH_SNIFF =
  /eauth|535|auth(entication)? (failed|invalid|denied|required)|must be authenticated|invalid (login|credentials|password)|username and password not accepted/i;

const TRANSIENT_SNIFF = /\b(421|451|452)\b|try again|greylist|temporarily deferred|please try later/i;

function smtpReply(err) {
  return Number(err && err.responseCode) || null;
}

function smtpText(err) {
  return String((err && err.response) || (err && err.message) || err || "");
}

function isSenderRejected(code, raw) {
  const text = String(raw || "");
  // Phrase evidence only. A bare 550/553/554 is not enough.
  if (SENDER_SNIFF.test(text)) return true;
  if (/sender verify failed/i.test(text)) return true;
  if ((code === 550 || code === 553) && /verif/i.test(text)) return true;
  return false;
}

function isRecipientRejected(code, raw) {
  const text = String(raw || "");
  if (RECIPIENT_SNIFF.test(text)) return true;
  if ((code === 551 || code === 553) && /recipient|user|mailbox/i.test(text)) return true;
  return false;
}

function isAuthFailure(err, code, raw) {
  if (err && err.code === "EAUTH") return true;
  if (code === 535) return true;
  return AUTH_SNIFF.test(String(raw || ""));
}

function isTransient(code, raw) {
  if (code === 421 || code === 451 || code === 452) return true;
  return TRANSIENT_SNIFF.test(String(raw || ""));
}

function mapSmtpError(err) {
  if (err instanceof AppError) return err;
  const code = smtpReply(err);
  const raw = smtpText(err);
  const details = { smtp_code: code, smtp_response: raw.slice(0, 300) };

  if (isAuthFailure(err, code, raw)) {
    return new AppError(
      "SMTP_AUTH_FAILED",
      "The mail server rejected the SMTP credentials for this mailbox.",
      502,
      details,
    );
  }
  if (isSenderRejected(code, raw)) {
    return new AppError(
      "SENDER_NOT_AUTHORIZED",
      "The mail server rejected the sender address. "
        + "The \"From\" address must be a real mailbox on a domain with valid "
        + "MX/SPF/DKIM records and usually has to match the login you connected with. "
        + "This is the mailbox's SMTP setup — not Praxis.",
      422,
      details,
    );
  }
  if (isRecipientRejected(code, raw)) {
    return new AppError(
      "RECIPIENT_REJECTED",
      "The mail server refused one or more recipients. "
        + "Check the To/Cc addresses exist and are allowed by the receiving server.",
      422,
      details,
    );
  }
  if (isTransient(code, raw)) {
    return new AppError(
      "SMTP_SEND_FAILED",
      "The mail server deferred the message. This is usually temporary — try again shortly.",
      502,
      details,
    );
  }
  if (code >= 500 || (err && err.code === "EENVELOPE")) {
    return new AppError(
      "SMTP_SEND_REJECTED",
      `The mail server rejected the message${code ? ` (${code})` : ""}.`,
      502,
      details,
    );
  }
  return new AppError(
    "SMTP_SEND_FAILED",
    "Could not send the message through the mail server.",
    502,
    { reason: raw.slice(0, 300) },
  );
}

function smtpCodeFromMessage(msg) {
  const text = String(msg || "");
  if (isAuthFailure(null, null, text)) return "SMTP_AUTH_FAILED";
  if (isSenderRejected(null, text)) return "SENDER_NOT_AUTHORIZED";
  if (isRecipientRejected(null, text)) return "RECIPIENT_REJECTED";
  if (isTransient(null, text)) return "SMTP_SEND_FAILED";
  if (/\b5\d\d\b/.test(text) || /rejected|refused|denied/i.test(text)) return "SMTP_SEND_REJECTED";
  return null;
}

function isSmtpError(err) {
  if (!err) return false;
  return !!(err.responseCode || err.code === "EAUTH" || err.code === "EENVELOPE" || smtpCodeFromMessage(err.response || err.message));
}

module.exports = {
  mapSmtpError,
  smtpCodeFromMessage,
  isSmtpError,
  isSenderRejected,
  isRecipientRejected,
};
