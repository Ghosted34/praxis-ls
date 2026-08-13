/**
 * SMTP fix-guide registry — the machine-code → operator-steps mapping shared
 * by the guide components. Codes come from the backend classifier
 * (src/modules/mail/smtp-error.map.js): SMTP_SENDER_REJECTED,
 * SMTP_AUTH_FAILED, SMTP_SEND_REJECTED, SMTP_SEND_FAILED.
 */
import { ApiError } from "./api-client";

export type SmtpGuide = { title: string; intro: string; steps: string[] };

export const SMTP_GUIDES: Record<string, SmtpGuide> = {
  SMTP_SENDER_REJECTED: {
    title: "550 Sender verify failed — the From address isn't accepted",
    intro:
      "The mail server checked the From address against the domain and found no real mailbox behind it. This is a DNS/mailbox setup problem, not a Praxis bug — fix it where the mail is hosted, then press Test again.",
    steps: [
      "Make the From address a REAL mailbox. The address you send from must exist on its domain (create the mailbox or alias — e.g. billing@yourco.cm — if it doesn't).",
      "Check the domain's DNS records. It needs a valid MX record; add an SPF record that allows your mail server, and DKIM so verification and spam filters pass. (Checkers: mxtoolbox.com, dmarcian.com, mail-tester.com.)",
      "Match From to the SMTP login. Send from the same address you authenticate with. If you must use another address (no-reply@, notifications@), create it as a real mailbox or alias first.",
      "On cPanel/Exim hosts this is caller-verification. In the hosting panel, allow authenticated senders to use any From address (Email → Mailserver configuration) — or simply send from the account's own address.",
      "On a relay (SendGrid, SES, Postmark), add the From domain as a verified sender identity in the relay's dashboard.",
      "Fixed it? Come back here and press Test to confirm.",
    ],
  },
  SMTP_AUTH_FAILED: {
    title: "SMTP login rejected",
    intro: "The server refused the credentials for this mailbox.",
    steps: [
      "Re-enter the password — the field is write-only, so a blank save keeps the old (wrong) one.",
      "Accounts with 2-factor authentication (Google, Microsoft 365) need an APP PASSWORD, not the normal login password.",
      "Check the SMTP user matches the mailbox account you're authenticating as.",
      "Check the port/security: 587 with STARTTLS, or 465 with SSL.",
    ],
  },
  SMTP_SEND_REJECTED: {
    title: "The mail server refused the message",
    intro: "The connection and login worked, but the server would not take the message.",
    steps: [
      "Check sending quotas/limits on the mailbox or relay (daily caps are the usual cause).",
      "Confirm the From domain is verified/allowed on your relay (SES/SendGrid/Postmark).",
      "If the server complains about content, check attachments and links in the message.",
    ],
  },
  SMTP_SEND_FAILED: {
    title: "Could not reach the mail server",
    intro: "The message never got to the server.",
    steps: [
      "Confirm the SMTP host and port are correct (587 STARTTLS / 465 SSL are standard).",
      "Make sure the network/firewall allows outbound SMTP ports.",
      "Check that the SMTP hostname resolves in DNS.",
    ],
  },
  // Codes from the mailbox-connection send path (mail.service explainSendError):
  // the connected mailbox's own server refused the send.
  SENDER_NOT_AUTHORIZED: {
    title: "Your mailbox isn't authorised to send as the From address",
    intro: "The mailbox's own mail server refused the message — this is the mailbox's SMTP setup, not Praxis.",
    steps: [
      "Make the From address a REAL mailbox on that server — create the mailbox or alias if it doesn't exist.",
      "Match From to the login: the address you send as must be the account you connected with (or an alias of it).",
      "Fix the connection: Comms → Mailbox → Edit on this mailbox, then Test.",
      "On a relay (SendGrid/SES/Postmark), verify the From domain as a sender identity.",
      "cPanel/Exim hosts: allow authenticated senders to use any From address, or send from the account's own address.",
    ],
  },
  MAILBOX_AUTH_FAILED: {
    title: "Login to the mailbox was rejected",
    intro: "The mailbox's mail server refused the username or password.",
    steps: [
      "Edit the mailbox (Comms → Mailbox → Edit) and re-enter the password — leave it blank to keep the current one.",
      "2FA accounts (Google, Microsoft 365) need an APP PASSWORD, not the normal login password.",
      "Check the username matches the mailbox account, then Test.",
    ],
  },
  MAIL_SEND_FAILED: {
    title: "The mailbox's server rejected the message",
    intro: "The connection works but the server would not take this message.",
    steps: [
      "Check sending quotas/limits on the mailbox or relay (daily caps are the usual cause).",
      "Confirm the From domain is verified/allowed on your relay (SES/SendGrid/Postmark).",
      "Check the message content — some servers refuse suspicious attachments or links.",
    ],
  },
};

/** Pick the right guide for a caught error (ApiError code first, message sniff
 *  as a fallback for older backends and probe results that lost the code). */
export function smtpCodeFor(err: unknown, message?: unknown): string | null {
  const code = err instanceof ApiError ? err.code : null;
  if (code && SMTP_GUIDES[code]) return code;
  const text = [
    message != null ? String(message) : "",
    err instanceof ApiError ? err.message : err instanceof Error ? err.message : "",
  ]
    .join(" ")
    .toLowerCase();
  if (text.includes("sender verify")) return "SMTP_SENDER_REJECTED";
  if (text.includes("535") || text.includes("eauth")) return "SMTP_AUTH_FAILED";
  if (text.includes("authori") || text.includes("not allowed to send") || text.includes("not author")) return "SENDER_NOT_AUTHORIZED";
  if (text.includes("login")) return "MAILBOX_AUTH_FAILED";
  if (/\b5\d\d\b/.test(text) || text.includes("rejected") || text.includes("refused")) return "SMTP_SEND_REJECTED";
  return null;
}

export const smtpGuideFor = (code: string | null): SmtpGuide | null =>
  code && SMTP_GUIDES[code] ? SMTP_GUIDES[code] : null;
