# Campaign email templates + per-template sender — SHIPPED (record)

> **Status: DONE. No action required from the BE dev.**
> This started life as a handoff proposing new endpoints. Those endpoints were built in
> session 8 (2026-07-18) and are live. The file is kept under its original name because
> several docs link to it; treat it as a **record of what shipped**, not a request.
> Everything below the divider is the original proposal, retained only for context.

_Originally written 2026-07-17 (FE stream). Companion to `doc/SESSION_HANDOFF.md`._

## What exists today

**Migration** — `migrations/tenant/0452_campaign_templates.sql` (renumbered from 0450 at the
PR #11 merge; 0450/0451 belong to the comms/mail stream).

- `campaign_sender` — `sender_id, from_name, from_address citext, domain, verified_at, created_at`
- `campaign_template` — `template_id, name, subject, body_html, from_sender_id → campaign_sender, timestamps`

**Endpoints** — on the existing `sales/marketing_campaign` module (MOD-22, basePath `/campaigns`),
all registered **before** `/:id` so the literal segments aren't captured as a campaign id:

| Verb | Path |
|---|---|
| GET / POST | `/campaigns/senders` |
| POST | `/campaigns/senders/:id/verify` |
| DELETE | `/campaigns/senders/:id` |
| GET / POST | `/campaigns/templates` |
| GET / PATCH / DELETE | `/campaigns/templates/:id` |
| POST | `/campaigns/:id/send` |

RBAC reuses MOD-22 (view/create/edit/delete), so a marketing role manages templates and senders
**without** settings-admin rights — which was the whole point of moving off `/settings`.

**Send fan-out** — `POST /campaigns/:id/send` (body `{ template_id }`, MOD-22 edit) renders the
template to every active `newsletter_subscriber` and enqueues one durable **email** queue job per
recipient (`jobs/handlers/email-send.js` → `email.service.send`). The template's sender identity is
passed as the `from` override (`"Name" <addr>`); transport still resolves per-tenant. A send is
blocked when `status = ENDED`.

**Frontend** — `features/sales/pages.tsx`: `TemplateForm` POST/PATCHes `/campaigns/templates` with a
sender picker over `/campaigns/senders` plus an inline **New sender** modal (`SenderForm`). Each
campaign card has a **Send…** button opening `SendCampaignModal` (template picker → "Queued to N
subscribers"). The old `/settings/campaign_template` calls are gone.

## Known gaps (still open, tracked in `doc/SESSION_HANDOFF.md`)

1. **No per-recipient merge.** `sendCampaign` sends `body_html` verbatim — no `{{name}}`-style
   substitution. Documented inline at `marketing_campaign.service.js:98`. This is the one item here
   with real user-facing value left.
2. **Sender verification is a manual stamp.** `campaign_sender.verified_at` is set by an admin via
   `POST /campaigns/senders/:id/verify`. There is no SPF/DKIM or domain-ownership check behind it,
   so a "verified" sender means "someone said so", not "the domain authorised us".
3. **No scheduling.** Send is immediate-enqueue only; there's no `/schedule` equivalent.

---

_Original proposal (2026-07-17), superseded — retained for context only:_

At the time, `marketing_campaign` (MOD-22) had **no** template or sender endpoints, so the FE
persisted templates in the generic tenant settings store: `GET /settings/campaign_template`,
`PUT /settings/campaign_template/:key` with `{ value: {...} }`, `DELETE /settings/campaign_template/:key`,
where `value` was `{ name, subject, from_name, from_address, body_html }` and `key` a slug derived
from the name. That worked because the settings store accepts arbitrary sections.

The three caveats that motivated the dedicated module — and how they landed:

| Caveat then | Now |
|---|---|
| `/settings/*` is MOD-70-gated, so a pure marketing role couldn't manage templates | **Resolved** — endpoints sit under MOD-22 |
| Templates were stored only; nothing sent through them | **Resolved** — `POST /campaigns/:id/send` |
| `from_address` was free text with no verification | **Partly** — there's a sender registry and a verify stamp, but no SPF/DKIM (gap 2 above) |
