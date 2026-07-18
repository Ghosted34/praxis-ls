# Campaign email templates + per-template sender — BE handoff

_Written 2026-07-17 (FE stream). Companion to `doc/SESSION_HANDOFF.md`._

## ✅ IMPLEMENTED (2026-07-18) — templates + senders

The dedicated module below was **built** and the FE moved off `/settings`:

- Migration `migrations/tenant/0450_campaign_templates.sql` adds `campaign_sender`
  (`sender_id, from_name, from_address citext, domain, verified_at, created_at`) and
  `campaign_template` (`template_id, name, subject, body_html, from_sender_id → campaign_sender, timestamps`).
- Endpoints added to the existing `sales/marketing_campaign` module (MOD-22, basePath `/campaigns`),
  registered **before** `/:id`: `GET/POST /campaigns/senders`, `POST /campaigns/senders/:id/verify`,
  `DELETE /campaigns/senders/:id`; `GET/POST /campaigns/templates`, `GET/PATCH/DELETE /campaigns/templates/:id`.
  Reuses MOD-22 RBAC (view/create/edit/delete) — a marketing role manages these without settings-admin.
- FE (`features/sales/pages.tsx`): `TemplateForm` now POST/PATCHes `/campaigns/templates` with a **sender
  picker** (Select over `/campaigns/senders`) + inline **New sender** modal (`SenderForm`); the old
  `/settings/campaign_template` calls are gone. `campaign_sender.verified_at` is a manual admin stamp
  (no SPF/DKIM yet).
- **Send fan-out — DONE (2026-07-18).** `POST /campaigns/:id/send` (body `{ template_id }`, MOD-22 edit)
  renders the template to every active `newsletter_subscriber` and enqueues one durable **"email" queue**
  job per recipient (delivered by `jobs/handlers/email-send.js` → `email.service.send`); the template's
  sender identity is passed as the `from` override (`"Name" <addr>`), transport still resolves per-tenant.
  Blocks a send on `status = ENDED`. FE: a **Send…** button on each campaign card opens `SendCampaignModal`
  (template picker) → shows "Queued to N subscribers". No per-recipient merge/personalisation yet (straight
  `body_html`). `npm test` + Windows lint/build authoritative; **apply migrations 0450 + 0451**.

---
_Original proposal (for reference):_

## What the FE now does (interim, working)

Marketing campaigns gained a **Templates** tab (`client/src/features/sales/pages.tsx`,
`CampaignsPage` + `TemplateForm`). Because the `marketing_campaign` module (MOD-22) has
**no** template or sender endpoints, the FE persists templates in the **generic tenant
settings store** instead:

- **List** — `GET /settings/campaign_template` → `[{ key, value, version, updated_at }]`
- **Create / edit** — `PUT /settings/campaign_template/:key` with body `{ value: {...} }`
- **Delete** — `DELETE /settings/campaign_template/:key`

Each template's `value` object is:

```json
{
  "name": "Monthly newsletter",
  "subject": "What's new this month",
  "from_name": "Praxis LS",
  "from_address": "news@tenant.cm",
  "body_html": "<p>…</p>"
}
```

`key` is a slug derived from the name on first save (kept stable on edit). This works
today because the settings store allows arbitrary sections (forward-compat) and only
requires the value to be a JSON object.

## Caveats to be aware of

1. **Permission coupling.** `/settings/*` is gated by **MOD-70** (settings admin). A pure
   marketing user without MOD-70 view/edit can't manage campaign templates yet. A dedicated
   module would let this sit under **MOD-22** with the sales/marketing role.
2. **No send integration.** These templates are *stored* only. Nothing sends a campaign
   through a template or validates/verifies the per-template sender address. `smartcomm` /
   `notification` don't expose template or sender-identity endpoints today.
3. **Sender identity isn't verified.** `from_address` is free text — there's no SPF/DKIM or
   domain-ownership check, and no allow-list of verified sending addresses.

## Proposed dedicated BE (so the FE can move off `/settings`)

Under `sales/marketing_campaign` (MOD-22), 7-file module convention:

- `GET/POST /campaigns/templates`, `GET/PATCH/DELETE /campaigns/templates/:id`
  — `{ name, subject, body_html, from_sender_id, ... }`
- `GET/POST /campaigns/senders`, `POST /campaigns/senders/:id/verify`
  — configured sending identities `{ from_name, from_address, verified_at, domain }`; a
  template references a sender, rather than embedding a raw address.
- `POST /campaigns/:id/send` (or `/schedule`) — render a template for the campaign's
  subscribers via the chosen sender, through `smartcomm`/`notification`.

When these land, swap the three `/settings/campaign_template` calls in `TemplateForm` /
`CampaignsPage` for the new endpoints and add a sender picker to the template form (replacing
the inline `from_name` / `from_address` fields).
