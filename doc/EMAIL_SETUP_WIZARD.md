# Mail setup guide (Zoho-style wizard) — Comms → Setup

Status: implemented 2026-08-13 · Scope: tenant client + smartcomm backend

## Product decision

A step-by-step setup assistant on **Comms → Setup**, opened from a **“📖 Setup guide”**
button (manual-only entry — no login auto-show). Four steps, completed in order,
each **auto-verified where the backend can**, and falling back to a self-check tick
only where a lookup is practically impossible (resolver failure, provider-only
verification). This is the Zoho pattern: verify what is verifiable, tell the
operator exactly which record to add, and don't let them continue until it passes.

## The four steps

| # | Step | Verification | Auto? |
| --- | --- | --- | --- |
| 1 | **Sender address** | ≥1 active per-section sender (`email_identity`) | auto (list) |
| 2 | **DNS records** | MX / SPF / DKIM lookups for the From domain — missing rows show the **exact TXT value to add** (copy button) + provider-aware hints (SendGrid/SES/Mailgun/Zoho/M365/… presets, `include:` for the SMTP host's domain) | auto (DNS) / self-check when lookup fails |
| 3 | **SMTP connection** | live nodemailer `verify()` against the shared SMTP login | auto on step entry |
| 4 | **Test email** | a REAL message sent through the tenant's transport (proves more than verify() — same reasoning as the platform alert-email probe) | on demand (needs a recipient) |

Failures reuse the existing `<SmtpErrorGuide />` (doc/SMTP_ERROR_GUIDE.md), so a
550 during steps 3–4 shows the same fix list the rest of the mail surfaces show.
The wizard resumes at the first unpassed step on open, shows step chips with a
progress bar, and ends on a summary card when all four pass.

## Implementation map

| Layer | File | Change |
| --- | --- | --- |
| Backend | `src/modules/mail/dns-check.js` | **new** — MX/SPF/DKIM verification with relay-aware suggestions; `ok: null` = uncheckable (self-check fallback) |
| Backend | `src/modules/smartcomm/smartcomm.config.service.js` | **new** `dnsCheck` (public-DNS read; uses the resolved transport only to sharpen SPF suggestions) and `testSend` (real send, SMTP verdicts classified via smtp-error.map) |
| Backend | `src/modules/smartcomm/smartcomm.routes.js` | `POST /smartcomm/config/email/dns-check` (gated `view` — reads public DNS) · `POST /smartcomm/config/email/test-send` (gated `create` — sends real mail) |
| Backend | `src/modules/smartcomm/smartcomm.controller.js` + `validator.js` | handlers + zod schemas (`emailDnsCheck`, `emailTestSend`) |
| Client | `client/src/features/comms/mail-setup-wizard.tsx` | **new** — the wizard (step chips, progress, copyable DNS values, self-check fallback, inline fix guides, summary) |
| Client | `client/src/features/comms/setup.tsx` | “📖 Setup guide” button + senders status pill in the page header |
| Client | `client/src/lib/smartcomm-api.ts` | `dnsCheckEmail`, `testSendEmail` + result types |

## Tests

`tests/unit/mail-setup.test.js` — 8 hermetic tests: full pass, missing records with
relay-aware suggestions, SPF on the parent domain, resolver-failure → `ok:null`,
invalid-domain rejection, and test-send classification (550 → `SMTP_SENDER_REJECTED`,
success message-id, raw reason preserved for non-SMTP failures). Backend suites,
client `tsc`/`eslint` and the 69-file vitest suite all pass.
