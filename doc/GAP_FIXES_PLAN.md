# Gap-Fix Plan — Reaching Pixie Parity (fit into existing modules)

Scope: close the backend gaps found vs. the Pixie reference
(`doc/SECURITY_BUSINESS_SETTINGS_IMPLEMENTATION.md`, Part A), **without creating
any new top-level modules**. Every gap folds into a module you already have, or
into the generic `setting(section, key, value)` store. Single-business-per-tenant
throughout — no brand key, tenant-scoped only.

## Guardrails

- No new `MOD-xx` unless the host module lacks one — reuse the host module's
  existing permission key and add the new action routes under it.
- Config-shaped data → `setting` via `shared/config/settings.js` (`getSetting`/
  `putSetting`). Row-shaped/workflow data → a table **inside the host module's**
  existing migration area.
- Audit through `shared/events/emit.js` → `immutable_ledger`; events via
  `emitEvent` → `event_log`. Never `shared.audit_log` / `business` columns.
- Secrets reuse the TOTP encryption service; never returned over the API.

---

## Tier 1 — Settings

### 1.1 Document templates → **`security/setting`**
Store in `setting` section=`document_template`, key=`<doc_type>`, value =
`{ name, status, subject, body_html, css_vars, version }`. Generic setting CRUD
already gives GET/PUT/DELETE per section/key; "default template for a doc_type" =
the single key for that type. Bump `version` in the value on `body_html` change
(do it in a thin `setting.rules.js` hook, not a new module). Multiple templates
per type → value becomes an array with one `is_default: true`.
*Alt home:* `vault` (document-centric) if templates need their own row lifecycle.

### 1.2 Notification preferences → **`notification`** (extend)
Add table `notification_preference(user_id, channel, category, enabled,
PRIMARY KEY(user_id, channel, category))` in the notification module's migration.
Add self-service routes (no `requirePermission`): `GET /notification-preferences`,
`PUT /notification-preferences`. Filter the fan-out in `emit.js` against prefs
before `INSERT INTO notification`; missing row = enabled (opt-out model).

### 1.3 Scheduled reports → **`vault/report`** (extend)
`vault/report` already generates report bodies. Add table
`scheduled_report(report_id, name, cadence, recipients text[], formats text[],
report_key, params jsonb, next_run_at, last_run_at, active)` in the vault module.
Add CRUD routes under vault's existing permission key. A BullMQ job (you already
run BullMQ) scans due rows per tenant and calls the existing report generators.
`cadence` enum `daily|weekly|monthly|quarterly|on_event`.

### 1.4 Integration secrets → **`security/setting`** (encrypted variant)
Reserve section=`integration_secret`. Extend the setting service so this section
is stored encrypted (AES-256-GCM via the TOTP encryption service) with `last4`
kept in cleartext; GET returns metadata + `last4` only, never the value. Audit
`is_sensitive: true`. Keeps API keys out of `.env` without a new module. Distinct
from `vault` (that's a *document* vault).

---

## Tier 2 — Business Setup

### 2.1 Email signatures → **`master/corporate_entity`** + **`security/app_user`**
Brand template (one per tenant) → `setting` section=`email_signature`,
key=`template`, exposed through `corporate_entity` routes. Per-staff render →
column/table on `app_user` with `GET/PUT /users/:id/email-signature`. No new module.

### 2.2 Custom field definitions → **`security/setting`**
`setting` section=`custom_field`, key=`<entity_type>`, value = array of
`{ field_key, label, field_type, options, required, sort, active }`. Consumers
read the defs to render/validate dynamic fields. Enums validated in the setting
validator for that section.

### 2.3 Payment gateways → **`master/treasury_account`** (extend)
Natural home — money-in config alongside bank/treasury accounts. Add table
`payment_gateway(provider PK, active, role, credentials_enc, has_credentials,
updated_at)` in the treasury module. Routes under treasury's permission key:
`GET /payment-gateways`, `POST /payment-gateways`,
`PATCH /payment-gateways/:provider/active`, `.../:provider/role`,
`DELETE /payment-gateways/:provider`. Credentials write-only (1.4 pattern);
GET returns `has_credentials` boolean only.

---

## Tier 3 — Appearance & Login (both → **`branding`**)

### 3.1 Appearance — widen the `branding` token set
Today stores 4 keys in `setting` section=`appearance`. Extend the `KEYS` map +
`getBranding`/`setBranding` in `branding.service.js` (no schema change — JSONB
key/value) to add: colours `accent`, `accent_deep`, `accent_glow`,
`secondary_color`, `info`, `success`, `warn`, `danger`; assets `favicon_url`,
`logo_alt_url`; type/shape `font_display`, `font_body`, `font_mono`, `radius`;
`brand_theme` (`dark|light`). Keep the public GET additive/backward-compatible.
One tenant = one theme, so Pixie's Layer-A/Layer-B collapses to a single layer.

### 3.2 Login screen editor — new `setting` section in `branding`
No equivalent today. In the same `branding` module add section=`login`:
`background_url`, `headline`, `subtext`, `layout` (`centered|split`), `show_logo`,
`accent_override`. Routes: `GET /branding/login` (PUBLIC, like the existing
pre-auth branding GET), `PUT /branding/login` (gated `MOD-70 edit`),
`POST /branding/login/background` (reuse `uploadLogo` storage under
`tenant_<slug>/login/`). Mirror `getBranding`/`setBranding`; audit `login.updated`.

---

## Tier 4 — IAM hardening

### 4.1 Access reviews → **`security/audit_ledger`** (extend)
audit_ledger already runs a maker-checker workflow (request/confirm restore), so
review decisions fit its shape. Add tables `access_review(...)` +
`access_review_entry(...)` there. Routes under its permission key: `GET/POST
/reviews`, `GET /reviews/:id`, `PATCH /reviews/:id`,
`PATCH /reviews/:id/entries/:entryId`, `GET /reviews/:id/export`. On create,
snapshot every ACTIVE `app_user` + roles into entries; decisions audited
`is_sensitive: true`.

### 4.2 Security-events read surface → **`security/audit_ledger`** (extend)
You already have `event_log.is_security_critical`. Add `GET /events` reading
security-critical `event_log` rows with filters (module/action/user/date). No new
table — a query + route on the existing module.

### 4.3 "Last owner" guard → **`security/iam_role`** / **`security/permission`**
In the grant-revoke path, before revoking the CEO/owner role, count active holders
and refuse if it would hit zero (`ConflictError "Cannot revoke the last owner"`).
Complements the existing system/CEO-role delete guard in `iam_role.service.js`.

---

## Sequencing
1. Tier 1 (setting-hosted: 1.1, 1.4, 2.2 are pure `setting` extensions — cheapest;
   then 1.2 notification prefs, 1.3 vault/report scheduling).
2. Tier 3.1 appearance (no migration).
3. Tier 2.3 payment gateways, 2.1 email signatures.
4. Tier 3.2 login editor, Tier 4 IAM.

## Verify per change
- RBAC denies without a grant; self-service (notification prefs) works without one.
- Writes land in `immutable_ledger`, not `shared.audit_log`.
- Secret sections never return the value (assert `*_enc` absent from responses).
- Public GETs (branding, login) work pre-auth; everything else 401s.
- No new top-level module dir added; each change lives in an existing module.
