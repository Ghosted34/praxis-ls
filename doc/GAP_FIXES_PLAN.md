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
_Alt home:_ `vault` (document-centric) if templates need their own row lifecycle.

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
from `vault` (that's a _document_ vault).

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

## Tier 5 — Document pipeline consolidation (follow-through on 1.1)

Audit finding: the document capability is smeared across four layers with no
owner — the `document_template` setting (1.1), two shared services
(`services/documents/document.service.js`, `services/pdf.service.js`), the
`vault` group (`document_vault`, `document_signature`, `document_verification`,
`compliance_flag`), and ~15 issuing modules that each call `documents.capture()`
with a hand-written `docType` string. 1.1 stores templates; nothing consumes
them. These fixes make the settings contract real and give the pipeline a spine.
No new top-level module — everything folds into `vault/document_vault`,
`security/setting`, and the shared `pdf`/`documents` services.

### 5.1 Enforce `document_template` at render → **`services/pdf.service`** + **`security/setting`**

The blocker. `document_template` (1.1) is validated on write but has **zero
readers** — `pdf.service.renderAndStore` takes fully-formed `html` from the
caller and the `pdf-render` job passes it straight through, so `body_html` /
`css_vars` / the draft→published→archived `status` render nothing. This breaks
the "settings must be enforced" rule: a configured template is a contract the
renderer must honor. Add a resolver — `renderDocType(client, { docType, data,
entityRef })` — that reads `getSetting(client, "document_template", docType)`,
**refuses a non-`published` template** (`CONFLICT "template not published"`),
interpolates `data` into `body_html`, injects `css_vars`, and hands the result to
the existing `renderAndStore`. Issuers stop passing raw `html`. Missing template
for a `docType` → explicit `NOT_CONFIGURED`, not a silent blank doc.

### 5.2 `doc_type` registry → **`vault/document_vault`**

Today all 15 issuers pass free-string literals (`"FINAL_INVOICE"`, …) into
`capture()`, and 1.1 keys templates "one per doc_type" — so template keys and
issuer strings can drift with nothing joining them. Add a single exported
`DOC_TYPES` map/enum in `document_vault` (the table's owner); `capture()` and the
5.1 resolver both validate `docType` against it. One list to keep template keys
and issuer calls in lockstep.

### 5.3 Unify capture semantics + audit → **`vault/document_vault`**

`capture()` (create-once, used by every system doc) emits **no event and no
audit**, while `createDocument()` (ad-hoc upload) emits `CREATED` + audit — so the
bulk of documents skip the trail that manual uploads get, wrong for compliance
evidence. And `final_invoice` calls `capture()` with no `storagePath` yet
`status: "VERIFIED"`, landing a row at `pending://…` **and** VERIFIED at once,
contradicting `fetchBytes`'s own NOT_READY-if-pending guard. Fix: `capture()`
emits `CREATED` on insert / `UPDATED` on sync + audits both; forbid a `VERIFIED`
status without a real (non-`pending://`) `storage_path` — a captured-but-unrendered
doc stays `PENDING` until `renderAndStore` supplies bytes.

### 5.4 Close the cross-module repo reach → **`vault/document_signature` / `document_verification`**

Both `sign` and `verify` import `document_vault.repo` directly, leaking through
the module boundary to another module's repo shape. Add the two reads they need
(`getByRef`, `getDoc`) to `document_vault.service` and have sign/verify depend on
the **service**, not the repo. SQL still lives only in `document_vault`'s repo;
the boundary stops leaking.

---

## Sequencing

1. Tier 1 (setting-hosted: 1.1, 1.4, 2.2 are pure `setting` extensions — cheapest;
   then 1.2 notification prefs, 1.3 vault/report scheduling).
2. Tier 3.1 appearance (no migration).
3. Tier 2.3 payment gateways, 2.1 email signatures.
4. Tier 3.2 login editor, Tier 4 IAM.
5. Tier 5 document pipeline — needs 1.1 landed first; do 5.2 (registry) → 5.1
   (resolver, the payoff) → 5.3 (capture/audit) → 5.4 (boundary).

## Verify per change

- RBAC denies without a grant; self-service (notification prefs) works without one.
- Writes land in `immutable_ledger`, not `shared.audit_log`.
- Secret sections never return the value (assert `*_enc` absent from responses).
- Public GETs (branding, login) work pre-auth; everything else 401s.
- No new top-level module dir added; each change lives in an existing module.
- (Tier 5) A `draft`/`archived` template refuses to render; an unknown `docType`
  is rejected, not silently blank; `capture()` writes to `immutable_ledger`; no
  row is `VERIFIED` while `storage_path` is `pending://`; sign/verify import the
  `document_vault` service, not its repo.
