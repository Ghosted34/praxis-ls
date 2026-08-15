# SMTP error guides in the UI (550 Sender verify failed & friends)

Status: implemented 2026-08-13 · Scope: tenant client, platform console, backend classification

## Problem

Outbound mail failures (e.g. **`550 Sender verify failed`**) surfaced as raw, truncated
messages with no guidance: a user seeing _"The mail server rejected the sender address
(550 Sender verify failed)…"_ had no idea which of the four causes applied to them, nor
where to fix it. Support had to hand-hold every case.

## Design decision

**One registry, keyed on the machine error code, rendered where the error appears —
plus an always-visible condensed card where admins configure mail.**

1. The backend already classifies SMTP verdicts into stable codes
   (`SMTP_SENDER_REJECTED`, `SMTP_AUTH_FAILED`, `SMTP_SEND_REJECTED`,
   `SMTP_SEND_FAILED`). The UI never used them — `errMsg()` dropped the code and
   showed only the message.
2. A single guide registry (`client/src/lib/smtp-errors.ts`) maps each code to
   operator-worded fix steps. One source of truth; the tenant console and the
   platform console cannot drift apart.
3. **Primary placement — inline, next to the error.** Every place an SMTP failure
   surfaces renders a collapsible "🛠 How to fix this" panel directly under the
   error message:
   - Tenant **Comms → Setup** — sender save error; shared-SMTP save error; failed
     **Test** result (the backend now returns `code` on the test result).
   - Tenant **Comms → Mailbox** — reply/send errors in the thread composer; the
     compose modal; the IMAP/SMTP connect form; the per-mailbox **Test** action.
   - Platform console **Integrations → Mail fallback** — a failed **Test** renders
     the same guide (its Test button lives in the card body so the guide has room).
4. **Secondary placement — persistent help on the config screens** (`MailTroubleshootingCard`
   in Comms → Setup; an expandable "Why would the Test fail?" in the platform
   console's Mail fallback card), so guidance is findable _before_ anyone hits the
   error. A support person can point an admin at the screen and the steps are there.

## What each code's guide says (condensed)

- **SMTP_SENDER_REJECTED (550 Sender verify failed):** make the From address a real
  mailbox; fix MX/SPF/DKIM; From must match the authenticated account; cPanel/Exim
  caller-verification setting; verify the domain on relays (SES/SendGrid/Postmark).
- **SMTP_AUTH_FAILED:** re-enter the password (write-only field); app password for
  2FA; SMTP user must match the mailbox; 587 STARTTLS / 465 SSL.
- **SMTP_SEND_REJECTED:** quotas/limits; From domain verified on the relay; content.
- **SMTP_SEND_FAILED:** host/port; firewall; DNS resolution of the SMTP host.

The mailbox-connection send path (compose/reply) classifies separately via
`explainSendError` in `mail.service.js` (`SENDER_NOT_AUTHORIZED`,
`MAILBOX_AUTH_FAILED`, `MAIL_SEND_FAILED`); those codes are registered in the
same client registry so every mail failure surfaces a guide, whichever path it
came from.

## Implementation map

| Layer   | File                                              | Change                                                                                                              |
| ------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Backend | `src/modules/mail/smtp-error.map.js`              | **new** — shared classifier (`mapSmtpError`, `smtpCodeFromMessage`, `isSmtpError`) extracted from `mail.service.js` |
| Backend | `src/modules/mail/mail.service.js`                | uses the shared classifier; `testConnection` returns `code` on SMTP verdicts                                        |
| Backend | `src/modules/mail/providers/imapSmtp.provider.js` | SMTP-stage `verify()` returns classified `code`                                                                     |
| Backend | `src/services/email.service.js`                   | `verifyTransport` (Comms → Setup Test) returns `code`; raw message kept for non-SMTP failures                       |
| Backend | `src/services/platform/settings.probes.js`        | `smtp` probe throws the classified message + `code`                                                                 |
| Backend | `src/services/platform/settings.service.js`       | `test` result includes `code`                                                                                       |
| Client  | `client/src/lib/smtp-errors.ts`                   | **new** — guide registry + `smtpCodeFor` (code first, message sniff fallback)                                       |
| Client  | `client/src/components/mail/smtp-guide.tsx`       | **new** — `SmtpErrorGuide` (inline, collapsible) + `MailTroubleshootingCard` (persistent)                           |
| Client  | `client/src/features/comms/setup.tsx`             | guide under save/test errors; troubleshooting card beside Credentials                                               |
| Client  | `client/src/features/comms/mail.tsx`              | guide under reply/send/connect/test failures                                                                        |
| Client  | `client/src/lib/mail-api.ts`                      | `TestResult.code`                                                                                                   |
| Console | `platform-console/src/features/Integrations.tsx`  | mail-fallback Test shows the guide; persistent "Why would the Test fail?" block                                     |

## Tests

`tests/unit/mail-service.test.js` (550 → 502 AppError mapping) and the email /
smartcomm / platform-mail / provider suites all pass; client `tsc --noEmit`,
`eslint`, and the 69-file vitest suite pass.
