# Praxis LS — Email: the two configurations

There are **two separate email configurations** in Praxis. They are often
confused; this doc exists so we never are.

| | **1. System email** | **2. Mailbox (messaging)** |
|---|---|---|
| What it is | Transactional sender for **system** messages the product generates: OTPs, invites, password resets, invoices/receipts, document links, notifications. | Each **user's own professional mailbox** — their company-domain address — echoed into the app so they can read, reply to and send mail without leaving Praxis. |
| Who owns the sender | The **tenant** (per-purpose `email_identity`) → falls back to a **Praxis-owned** sender. | The **individual user** (their company email + credentials). |
| Where it lives | `email_identity` + `email.default` setting; fallback in platform `mail.fallback` / env. | `email_connection` (IMAP/SMTP or Microsoft 365 / Google OAuth). |
| Backing module | `src/services/email.service.js` | `src/modules/mail/` (+ BullMQ sync workers, Mail UI). |
| Send path | `email.service.send(client, { purpose: "BILLING" | "DOCUMENTS" | "NOTIFICATIONS" | "SUPPORT" })` | `mail.service.send / reply` through the provider adapter. |
| Direction | Outbound only (to users/clients/portals). | Inbound + outbound. |
| Configured in | Settings → per-purpose sender; **Platform Console → Integrations → System-email fallback sender** for the fallback. | Mail UI → Mailboxes (connect). |

---

## Why a fallback for system emails

A tenant who has **not** configured their own mail (no `email_identity`, no SMTP
in Settings, DNS not pointed at us) must still receive system emails. Without a
fallback those OTPs and invoices would silently fail to send.

So resolution for **system emails** is:

```
from + transport  ← email_identity(purpose)   # tenant's own verified sender
                 → email.default setting       # tenant's shared SMTP login
                 → PLATFORM mail.fallback      # Praxis sender + deploy-wide SMTP
                 → env (SMTP_* / MAIL_*)       # last-resort default
```

When the fallback is used, system emails go out from a Praxis-owned address:

- **`no-reply@praxisls.com`** — transactional (OTP, invites, invoices, documents, notifications)
- **`support@praxisls.com`** — the `SUPPORT` purpose

…sent through the deploy-wide SMTP. **That fallback is configured + live-tested
in the Platform Console** (Integrations → System-email fallback sender), stored
encrypted in the platform `mail.fallback` setting — *not* in env. The env vars
(`SMTP_*`, `MAIL_DEFAULT_FROM`, `MAIL_SUPPORT_FROM`, `MAIL_FALLBACK_DOMAIN`) are
only the last-resort defaults for a fresh deployment.

> Note on DNS: for the fallback to be *deliverable* (not just sent), `praxisls.com`
> itself must be properly set up with SPF/DKIM/DMARC on the deploy-wide SMTP.
> That is a one-time Praxis-side task, not something tenants configure.

## The mailbox is independent

A user connects their mailbox (their company-domain professional address) in the
**Mail** UI. Once connected, Praxis echoes inbound mail and sends outbound mail
**as that mailbox** — `email_connection`, never the system-email sender. So a
user whose company has configured their own DNS sees their mail from their own
domain, and system emails (from the tenant / Praxis) stay clearly separate.
