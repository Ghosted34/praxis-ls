# Praxis LS — Frontend IA Map & Backend Gaps (Handoff)

_Prepared 2026-07-13. Maps `src/modules/*` onto the frontend navigation, and lists backend
gaps to close. Excludes `ai/` (its own surface) and `branding` + `catalogue` (these two are
tabs under **Settings**, per decision)._

**How to read this.** Each top-level module with sub-folders is a **menu group**; its
sub-folders are **sub-menus**. Every sub-menu is classified as a **Standalone** screen (its
own nav slot / route) or a **Tab** (rendered inside a parent screen). Tabs list their parent.
Classification was inferred from each module's domain role and the HTTP routes it actually
exposes, and cross-checked against the screens already wired in
`client/src/app/screen-registry.json` (Fleet, WMS, HR, and most of Finance are mapped there
already).

---

## 1. Menu groups → sub-menus

### Commercial
| Sub-menu | Type | Parent / notes |
|---|---|---|
| Quotation | Standalone | Primary object |
| Margin simulation | Tab | → Quotation (pricing workbench) |
| Extra-charge simulation | Tab | → Quotation (pricing workbench) |
| Pricing variance | Standalone | Analytics (GET-heavy) |

### Costing
| Sub-menu | Type | Parent / notes |
|---|---|---|
| Costing | Standalone | Job-costing sheet |
| Cost tracking | Tab | → Costing (actuals vs sheet) |
| Cash request | Standalone | Own approval workflow |
| Regie | Standalone | |

### Finance (all primary accounting objects → all standalone)
| Sub-menu | Type | Parent / notes |
|---|---|---|
| Journal entry | Standalone | Journals |
| Proforma | Standalone | Proforma & advances |
| Final invoice | Standalone | Invoices |
| Smart receivables | Standalone | Receivables |
| Asset | Standalone | Fixed-asset register |
| Financial statement | Standalone | Internally tabbed: Trial balance / Bilan / Compte de résultat / TAFIRE |
| Tax declaration | Standalone | Internally tabbed: TVA / IS / withholding. **Read-only backend — see gaps** |
| Debt | Standalone | **NEW — not yet in screen-registry; partial backend (see gaps)** |

### Fleet (all standalone — matches registry)
| Sub-menu | Type | Parent / notes |
|---|---|---|
| Vehicle | Standalone | |
| Vehicle compliance | Standalone | Candidate tab under a Vehicle detail |
| Fuel log | Standalone | Candidate tab under a Vehicle detail |
| Work order | Standalone | |
| Fleet dispatch | Standalone | |
| Driver | Standalone | Driver licences |
| Incident | Standalone | |

### HR (all standalone — matches registry)
| Sub-menu | Type | Parent / notes |
|---|---|---|
| Employees | Standalone | (lives in HR; source module is `master/employees`) |
| Vacancy | Standalone | |
| Talent pool | Standalone | Candidate tab under Vacancy/Recruitment |
| HR contract | Standalone | |
| Appraisal | Standalone | |
| Attendance | Standalone | |
| Leave & allowance | Standalone | |
| SOP / onboarding | Standalone | |
| Training | Standalone | |
| Payroll | Standalone | |

### Master (mixed — primary records vs config lookups)
| Sub-menu | Type | Parent / notes |
|---|---|---|
| Client master | Standalone | Clients |
| Supplier master | Standalone | Suppliers |
| Chart of accounts | Standalone | → lives under Finance |
| Employees | Standalone | → lives under HR |
| Corporate entity | Standalone | → Settings / Company |
| Treasury account | Standalone | → Finance or Settings |
| Currency | Tab | → **Reference data** screen (config lookup) |
| Expense rate | Tab | → Reference data |
| Financial dictionary | Tab | → Reference data |
| Tax jurisdiction | Tab | → Reference data (or Settings / Tax) |

### Operations (the freight-forwarding file is the hub)
| Sub-menu | Type | Parent / notes |
|---|---|---|
| Operations file | Standalone | Central shipment / job file |
| Milestone | Tab | → Operations file |
| Transit order | Standalone | Own register; also surfaces as a tab in the file |
| Delivery note | Standalone | Own register; also surfaces as a tab in the file |

### Procurement (procure-to-pay chain — all standalone)
| Sub-menu | Type | Parent / notes |
|---|---|---|
| Purchase request | Standalone | |
| Purchase order | Standalone | |
| Goods received (GRN) | Standalone | Candidate tab under Purchase order |
| Supplier invoice | Standalone | AP / 3-way match |

### Sales / CRM
| Sub-menu | Type | Parent / notes |
|---|---|---|
| Lead | Standalone | |
| Inbound intake | Tab | → Lead (capture) |
| Opportunity | Standalone | Pipeline |
| Proposal | Tab | → Opportunity (also viable standalone) |
| Meeting | Tab | → Opportunity / Lead (activities) |
| Marketing campaign | Standalone | |
| Success story | Tab | → Marketing campaign (references / case studies) |

### Security / IAM (one "IAM & Access" screen, tabbed)
| Sub-menu | Type | Parent / notes |
|---|---|---|
| App user (Users) | Tab | → IAM & Access |
| IAM role (Roles) | Tab | → IAM & Access |
| Permission (matrix) | Tab | → IAM & Access |
| Capability | Tab | → IAM & Access |
| Scope | Tab | → IAM & Access |
| Field visibility | Tab | → IAM & Access |
| Session | Standalone | Sessions (or tab in IAM/Security) |
| Audit ledger | Standalone | Governance |
| Setting | Standalone | **Settings hub** — branding + catalogue + numbering as its tabs |
| Numbering setting | Tab | → Settings |

### Vault
| Sub-menu | Type | Parent / notes |
|---|---|---|
| Document vault | Standalone | **Read-only backend — see gaps** |
| Document signature | Tab | → Document vault |
| Document verification | Tab | → Document vault. **Incomplete module — see gaps** |
| Compliance flag | Standalone | (or tab) |
| Report | Standalone | Reports |

### WMS (all standalone — matches registry)
| Sub-menu | Type | Parent / notes |
|---|---|---|
| Inventory | Standalone | |
| Warehouse location | Standalone | Candidate tab/config under Inventory |
| Inbound | Standalone | GRN / QA gate |
| Outbound | Standalone | Pick / pack / dispatch |
| Equipment | Standalone | |
| Cycle count | Standalone | Candidate tab under Inventory |

### Dashboard (special — the home / control-tower area)
| Sub-menu | Type | Parent / notes |
|---|---|---|
| Dashboard | Standalone | Control Tower home (already `/`) |
| Workspace | Tab | → home ("My Workspace"), or standalone |
| Godmode | Standalone | Platform / superadmin only |

---

## 2. Previously-ungrouped modules (no sub-folders) — placed as their own screens

These five top-level modules have no sub-folders, so they aren't menu *groups* — but each is a
real surface and needs a home. Proposed placement:

| Module | Screen(s) | Placement | Notes |
|---|---|---|---|
| `notification` | Notifications | Top-bar / Governance | Caller's own inbox — read + mark-read only (rows written by the event engine; no CRUD by design). |
| `workflow` | Workflows **+** Approvals | Governance | Event-engine admin (event types / workflows / steps) **and** the runtime approval queue. Two screens; both already in registry. |
| `smartcomm` | Smart Comms (Messages) | Top-level surface (top-bar icon) | Corporate WhatsApp-style messaging: channels, DMs, presence, drafts, certified export. Rich module. |
| `platform` | Platform Console | Separate **superadmin** area | Cross-tenant admin: tenants, plans, catalogue, go-live/suspend, capacity. Not a tenant-facing screen. |
| `portal` | Portal Access (internal) **+** external Client/Investor/Auditor views | Split | Internal grant-management screen belongs under Settings/Security; the external read surfaces are a separate external app (magic-link auth). |

---

## 3. Backend gaps (to close)

1. **`finance/tax_declaration` is GET-only.** 5 GET routes, no writes — the Tax Center can't
   file/submit a declaration. Needs create/submit endpoints. Also: a stray
   `tax_declaration.service.js.bak` is sitting in the folder — delete it.
2. **Credit notes: no module at all.** Schema has `type='CREDIT_NOTE'` but there's no
   `finance/credit_note` folder, so nothing creates one. Needs a full module.
3. **`vault/document_vault` is read-only.** 3 GET routes, no create/upload/delete — documents
   can't be added to the vault via API.
4. **`vault/document_verification` is an incomplete module.** Missing `.repo.js` and
   `.validator.js` (only ai/controller/events/routes/service present); just 2 GET routes.
5. **`finance/debt` is partial + unwired.** GET + POST only (no edit/patch, no delete), and
   it's not in `screen-registry.json` yet → needs a new FE screen.
6. **Quick PIN login** (carried from prior handoff) — still no backend endpoint (device-bound
   fast unlock).
7. **Thin/read-only — confirm intent:** `dashboard/workspace` (1 GET) and
   `vault/document_signature` (1 GET / 1 POST) — verify these are meant to be minimal, not
   unfinished.

8. **LIVE/TEST toggle logs the user out (auth is env-schema-bound).** `X-Praxis-Env` switches
   the whole request to a separate DB schema *including* the auth path (`getAuthUser`,
   session/refresh lookups), and accounts exist only in the live schema — so flipping to Test
   points your login at an empty sandbox schema and bounces you to `/login`. Fix: make identity
   env-independent (pin auth/session lookups to the live/identity schema; only sandbox business
   data). Full diagnosis + fix options in §5 below and `doc/SESSION_HANDOFF.md`.

9. **Branding / white-label schema is minimal — blocks the Appearance + Login editors.**
   `branding.service.js` persists only **four** appearance keys (`display_name`, `primary_color`,
   `primary_foreground`, `logo_url`). The FE Appearance and Login-screen editors (built to the
   pixie spec) send a much larger `PUT /branding` payload that the backend currently drops, so
   those fields don't survive reload. Full field list to add in §6.

**Not a gap (noted to avoid confusion):** `security/app_user` looks route-less to a naive
grep but is fine — it builds two explicit sub-routers (`/users` CRUD and `/auth` login/refresh/
logout/2fa) rather than top-level `router.get(...)` calls.

---

## 4. Likely build targets

- **Settings hub** with its tabs: **Appearance** (branding — exists), **Catalogue**, and
  **Numbering**. Corporate entity / reference-data lookups (currency, expense rate, financial
  dictionary, tax jurisdiction) are candidates to fold in here as a **Reference data** screen.

---

## 5. Live / Test environment — logout bug + toggle UI (full spec for the BE colleague)

This is the top item to resolve before Test mode is usable. Two parts: (5a) a **backend**
architectural fix that stops the toggle from logging you out, and (5b) **frontend** polish for
the toggle itself. 5b only *works* once 5a lands.

### 5a. Why the LIVE/TEST toggle logs you out (backend)

**Symptom.** Click the Live/Test switch → you're bounced to `/login`. It only happens when
flipping into **Test**, and it's not the UI calling logout.

**Root cause — identity is bound to the environment schema.** `X-Praxis-Env` is not cosmetic;
it selects a **separate Postgres schema** (live vs sandbox). The trace:

1. `src/middleware/tenant-context.js` reads `X-Praxis-Env`, sets `req.env`, and binds
   `req.tenantDb = (fn) => registry.withTenantConnection(req.tenant, env, fn)`.
2. `src/services/tenant/registry.service.js` → `withTenantConnection` runs
   `SET search_path = <live_schema | sandbox_schema>, public`. So **every** query in the request
   hits that one schema.
3. The **auth path uses that same env-bound connection:**
   - `src/middleware/auth.js` verifies the JWT signature (env-independent) but then loads the
     user with `req.tenantDb((client) => identityCache.getAuthUser(client, payload.sub))` — reads
     `app_user` **in the env schema**.
   - `src/modules/security/app_user/app_user.service.js` → `refresh()` validates the session with
     `repo.getActiveSession(client, sid)` against `user_session` — also **in the env schema**.
     Login writes the `user_session` row through the same env-bound client.
4. Accounts are created in **live** by default (`scripts/tenant/create-admin.js` → `--env=live`).
   The sandbox schema has **no `app_user` row and no `user_session` row** for you.

**Result chain when env flips to sandbox:** next request → `auth.js` → `getAuthUser` in sandbox
→ no user → `401 USER_INACTIVE` → the FE api-client auto-tries `/auth/refresh` (also under
sandbox env) → `getActiveSession` in sandbox → no session → `401 SESSION_REVOKED` → refresh
fails → `/login`. The `window.location.reload()` in `toggleEnv()` isn't the cause; it just fires
the chain immediately. Even without a reload, the next authenticated call would 401 the same way.

**Recommended fix — make identity env-independent.** "Test mode" should mean *the same you
looking at sandbox business data*, not a separate empty database. So resolve identity from a
fixed schema regardless of `req.env`:

- In `tenant-context.js`, expose an identity-scoped connection alongside the env one, e.g.
  `req.identityDb = (fn) => registry.withTenantConnection(req.tenant, "live", fn)` (or a dedicated
  shared/identity schema if you'd rather not overload "live").
- Switch these to `identityDb`: `auth.js` `getAuthUser`; `app_user.service.js` `login`
  (session write), `refresh` (`getActiveSession`), `logout` (session kill); and the
  `security/session` module (list / remote-kill). The Redis session index is already
  environment-tagged, so it's fine.
- **Decision needed:** should RBAC (`iam_role` / `permission` / `scope` / `capability` /
  `field_visibility`) also be identity/shared? Almost certainly yes — a user's roles shouldn't
  differ between live and sandbox. Keep **business/transaction** data and **audit** env-scoped;
  keep **identity + RBAC** shared.
- Net effect: toggling env keeps you logged in; only the data underneath changes.

**Alternative (not recommended):** seed the sandbox schema with the same users + sessions.
Means two session rows to keep in sync, remote-kill has to span both, and login state still
wouldn't naturally carry across. More moving parts for a worse result.

**Files to touch:** `src/middleware/tenant-context.js`, `src/middleware/auth.js`,
`src/modules/security/app_user/app_user.service.js` (+ `app_user.repo.js`),
`src/modules/security/session/*`, and a helper on `src/services/tenant/registry.service.js` if a
dedicated identity schema is chosen. `scripts/tenant/create-admin.js` unaffected (identity stays
in live).

### 5b. Toggle UI (frontend, after 5a)

Current shell (`client/src/app/layout/app-shell.tsx`) has a single pill that flips
`praxis.env` and does `window.location.reload()`. Target (Lovable/pixie reference):

- A **segmented `Live | Test` control** (not a single pill).
- A **full-width warning banner** when in Test: *"TEST MODE — SANDBOX DATA · OUTBOUND EMAIL & AI
  DISABLED · SEPARATE NUMBERING"* (yellow hazard styling).
- **No hard reload** — set env, then trigger an in-app data refetch / route remount so the
  in-memory access token is kept (works cleanly once 5a makes identity env-independent).

FE-only, but do it after 5a or it'll appear to keep logging you out during testing.

---

## 6. Branding / white-label schema (BE gap for the Appearance + Login editors)

The FE editors are built to the pixie spec and **send** all of the fields below on
`PUT /branding` (forward-compatible), but `branding.service.js` only stores four of them today
(`display_name`, `primary_color`, `primary_foreground`, `logo_url`). To make Appearance + the
Login-screen editor persist, extend the `appearance` settings (the `setting` table, section
`appearance`) to store the rest, and widen the `getBranding` / `setBranding` shape to match the
frontend `Branding` type in `client/src/lib/branding.ts`.

**Already persisted:** `name`, `primary`, `primaryForeground`, `logoUrl`.

**Appearance — platform (Layer A), to add:**
`companyName`, `tagline`, `logoDarkUrl`, `faviconUrl`, `themePreset`,
`tokensDark` (colour bag: `--bg, --panel, --panel-2, --text, --text-muted, --text-faint,
--border-c, --accent, --accent-deep, --sage, --info, --success, --warn, --danger, --rose`),
`tokensLight` (same keys), `panelAlpha`, `borderAlpha`, `meshOpacity`,
`typography { display, body, mono, customFontUrl }`.

**Appearance — per-business (Layer B), to add:**
`businesses[]` where each = `{ id, name, accent, gradientStart, gradientEnd, logoUrl, website }`.

**Login screen, to add:**
- Hero (reuse the existing `hero` block — note it isn't persisted today either):
  `hero { eyebrow, headline, subheadline, imageUrl }`.
- `login { splashSubline, buttonLabel, background ("mesh"|"image"), showSplash,
  showWebsiteLinks, showQuickPin, quotes[{text, attribution}], pillars[{icon, title, body}],
  regionals[{region, title, body}] }`.

**Images:** all image fields reuse the existing `POST /branding/logo` upload (returns a `/media`
URL); the backend just needs slots to store the returned URLs (only `logo_url` exists now).
Favicon ideally also generates app icons.

**Also live-apply (theme.ts):** the token bag uses pixie token names (`--bg`, `--panel`, …)
which don't match the app's current CSS variables (`--background`, `--card`, …). Persisting the
tokens is step one; actually *applying* them at runtime needs `src/lib/theme.ts` to map/emit
them (or a decision to rename the app's tokens to the pixie set). Until then the token editor
saves values but doesn't retheme the running app — flagged in-UI as "pending backend".

### 6a. Stub inventory — decide keep / cut / promote

The Appearance + Login editors were built in full (pixie spec), but only `name`, `primary`
(brand accent), and `logoUrl` (light-background logo) persist today. Everything below is a
**stub**: fully built and editable in-UI, sent on save, badged "pending backend", but with no
storage yet. **Team to decide per item** — *keep* (build the BE field), *cut* (remove the
control + drop from the §6 spec), or *promote now* (trivial single-field adds). Nothing here is
load-bearing, so cutting any is safe.

Appearance — Layer A (platform):
- [ ] Company name — _promote candidate (trivial)_
- [ ] Tagline — _promote candidate (trivial)_
- [ ] Logo (dark background)
- [ ] Favicon — _promote candidate (trivial); ideally also generates app icons_
- [ ] Theme presets (Maroon Noir / Porcelain White / Onyx Rally)
- [ ] Token editor — full colour bag, dark + light (15 tokens each) — _also needs theme.ts to apply live_
- [ ] Alpha/mesh sliders (panel-alpha, border-alpha, mesh-opacity)
- [ ] Typography (display / body / mono + custom-font URL)

Appearance — Layer B (per-business), the whole block:
- [ ] Businesses[] (tabs, accent, gradient start/end, brand chip, business logo, website)

Login screen editor (the whole screen; `hero` isn't persisted today either):
- [ ] Splash subline
- [ ] Hero (eyebrow / headline / subline / button label)
- [ ] Background mode toggle + login background image
- [ ] House quotes
- [ ] Pillars ("The Standard")
- [ ] Regional welcomes (7 continents)
- [ ] Show/hide toggles (splash, website links, Quick PIN)

Live already (not stubs): product/display name, brand accent (`primary`), light-background logo.
