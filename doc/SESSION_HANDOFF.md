# Praxis LS — Session Handoff

Paste-in context for a fresh session. Companions: `doc/WORK_DONE.md` (append-only record of
what happened and why), `doc/WORK_TO_BE_DONE.md` (backlog with dated audit banners), and
**`doc/SESSION_HISTORY.md`** (session logs 1–15, plus the 2026-07-18 post-merge reconciliation
and the answered BE open questions).

_Last updated: 2026-08-02 (session 19)._

> **Restructured 2026-08-02.** This header used to be a single 4,000-word paragraph that every
> session prepended to — ten pages of prose in front of a document whose job is fast context
> transfer. Detail was not deleted: every session's log still exists, sessions 16–18 below and
> 1–15 in `SESSION_HISTORY.md`, with the full record in `WORK_DONE.md`. Keep it this way — add a
> line to the index and a log section, not a paragraph to the top.

## Where things stand

- **The approval engine enforces something for the first time.** It was designed well and wired to
  nothing: steps bound to a role, a scope and a capability, and `act()` checked only that the task
  was still PENDING. A chain routed *notifications*, not authority. Session 19 closed that —
  eligibility, maker-checker, per-module gating, and the bypass routes. **Proven end to end on
  smartls** (submit → task → self-approval refused → second user approves). Read
  `doc/ORGANOGRAMME_AUDIT_2026-08-02.md` before touching any of it.
- **The organigramme is real.** `scope` is the entity/branch/**department** tree; `user_scope` had
  no write path anywhere, so nobody could be in it. There is now an assignment UI, a chart at
  Security → Scopes, and departments across HR/procurement are scopes rather than free text (`0490`).
- **TEST mode is writable for the first time since session 3.** Identity is pinned to the LIVE
  schema while business data writes to the env-selected one, and 60+ tenant columns are
  `REFERENCES app_user(user_id)` — so a user missing from `sandbox.app_user` makes that user's TEST
  writes fail with 23503, usually *after* the row has committed. Mirroring now runs on user
  create/update and on every deploy (`shared/db/sandbox-user-mirror.js`).
- **The external client portal is live** at `/client-portal` — client + investor terminals, with an
  invite/reset flow (`0482`) that creates the login a grant was always missing. Auditor room is
  still a backend placeholder.
- **AI has memory that doesn't forget**: 20 turns replayed verbatim, everything older folded into a
  rolling summary (`0481`). AI itself is still **off** by design (`ai.*` features seeded off).
- **`/media` is safe under S3** ahead of the migration — the bucket needs no public-read.
- Backend phases 0–4 substantially built. Frontend is a Vite/React 18/TS SPA on the Lovable
  "Control Tower" look, with a separate `platform-console/` app served only on the admin host.

## Open right now

1. **Auditor portal — BUILT (session 19).** Disclosure policy set: statements + trial balance +
   procurement + a period-scoped GL/document audit trail with the acting user named; HR, payroll and
   security/permission events excluded by an allow-list in `repo.auditLedger`; document files stay behind the
   gated vault download. `portal.service.auditorView` composes it; grants time-box via `portal_access.expires_at`.
   FE: the `/client-portal` **Audit room** terminal is live (session 19).
2. **PRD open question 4 — RESOLVED as OHADA (session 19).** No IFRS restatement layer is built or planned;
   `investorView` stays OHADA-basis and now carries net-margin / expense-ratio KPIs. Revisit only for a concrete
   IFRS-reporting investor.
3. **Before a real external party uses the portal**: tenant SMTP must be configured (or invites
   fail silently from the recipient's side), the `portal.*` feature flags must be on (or staff
   previews 403 while the external view works), and one click-through should prove a client sees
   their own dossiers and nobody else's.
4. Full open list with file+line evidence: `WORK_TO_BE_DONE.md`, "Repo audit — 2026-08-02".

## Three rules that have each cost a session

- **Never renumber an applied migration.** The migrator keys on filename, so a rename re-runs it —
  and tenant migrations are not idempotent (23 use a bare `CREATE TRIGGER`, which fails `42710`).
  The `0470`/`0475` collisions are grandfathered; CI blocks only new ones.
- **Feature gates deny before RBAC does.** `requireFeature` mounts in front of the whole router and
  has no CEO bypass. If a screen 403s, run `node scripts/tenant/feature-report.js --slug=<slug>`
  before suspecting permissions.
- **The bash mount serves stale copies of freshly written files.** In-sandbox `node`/`jest` can
  fail on files that are actually fine — and it can hide a file *entirely*: on 2026-08-02 four
  greps reported `9120_hr_discipline_module.sql` did not exist, and an audit wrongly accused a
  colleague of shipping an uncatalogued module key on that basis. Windows validators are
  authoritative — see "Sandbox gotcha" at the end.
- **Test as a non-CEO user, or you are not testing.** The CEO bypasses `requirePermission`
  entirely, so every route passes for whoever wrote it. One session-19b afternoon as a Sales user
  found four separate screens where an ordinary action sat behind an administrator's permission
  (department picker → IAM, every document View → Settings, purchase-request Submit → `approve`,
  and the scope tree → IAM). All four were invisible to CEO testing. See
  `doc/PERMISSION_SWEEP_BACKLOG.md`.

## Session index

Newest first. Sessions 16–18 log below; 1–15 in `doc/SESSION_HISTORY.md`.

| # | Date | Headline |
|---|---|---|
| 19b | 2026-08-02 | **Approval engine made to enforce** (eligibility, maker-checker, per-module gating, bypasses closed — `0488`–`0492`); organigramme wired (`user_scope` assignment + chart); departments became scopes (`0490`); PRs joined the engine (`0491`); **reporting line — B1** (`0493`); **auth: session recovery + "keep me signed in" honoured** (`0494`); mail RBAC (`MOD-72`); permission matrix stopped wiping grants; screen registry 59→96 |
| 19 | 2026-08-02 | `depends_on` enforced at projection; **user↔capability assignment built** + `requireCapability` mounted on disburse/costing-status (`0487` backfill); **self-grant maker-checker block**; AssetsPage write UI (create/depreciate/dispose) |
| 18 | 2026-08-02 | TEST-mode writes fully fixed; AI rolling summary (`0481`); `/media` safe under S3; **client + investor portals** (`0482`); open-list re-audit |
| 17 | 2026-08-01 | Control Tower map made real (`0478`/`0479`); `/media` bypass closed; milestone auto-seeding; AI memory; service types + `0480`; doc-truth audit |
| 16 | 2026-07-29 | Document-UI overhaul; master emails (`0475`); document line items (`0476`); logo fix; AI vendor keys → platform |
| 15 | 2026-07-27 | Lovable kit fidelity; per-screen AI gate; workflow blocks; HR succession + onboarding modules |
| 14 | 2026-07-24 | Feature-toggle → tenant-screen fix; platform RBAC (`0031`); Plans CRUD; tenant lifecycle |
| 13 | 2026-07-23 | Platform Console built from zero; Support & Feedback end-to-end |
| 11 | 2026-07-22 | Sandbox data tooling; S3 driver; Fleet/WMS/HR CRUD; real-time comms; portal auth (`0460`) |
| 10 | 2026-07-20 | Feature-gate root cause (19 modules dark for everyone); Pixie permission matrix; Control Tower de-mock |
| 9 | 2026-07-19 | Security CRUD + Security/Vault hubs; Control Tower drill-downs; Governance |
| 8 | 2026-07-18 | FE follow-ons + all pending BE jobs |
| 7 | 2026-07-17 | Cross-cutting FE pass: token rotation, search everywhere, quotations, campaigns |
| 6 | 2026-07-17 | Sales/CRM funnel + Commercial group |
| 5 | 2026-07-16 | Master-data trio; global AI gate; BE `ai_enabled` |
| 4 | 2026-07-15 | Settings tiles; per-tenant PWA; screen scaffolds |
| 1–3 | 2026-07-13/15 | IA menu + ⌘K palette; landing/login rebuild; test isolation; identity pinned to live; LIVE/TEST toggle |

## Project

Praxis LS (SmartLS) — multi-tenant OHADA/Cameroon logistics + accounting ERP.
- **Backend:** Node 20 CommonJS + Express + PostgreSQL 16/pgvector + Redis. Repo root.
- **Frontend:** Vite + React 18 + TS SPA in `client/`.
- **Working folder:** `C:\Users\user\Documents\work\praxis-ls` (was
  `C:\Users\Grey\Documents\work\praxiz\praxis-ls` — corrected 2026-08-01 after a machine change).

## Read first

`doc/WORK_DONE.md` (newest on top), `doc/WORK_TO_BE_DONE.md` (phase backlog with dated
audit banners), `doc/CONVENTIONS.md`, `doc/BUILD_CONVENTIONS.md`, `doc/AI_READINESS.md`.
Design reference: `doc/reference/reference-mock-lovable`.

`doc/SESSION_HISTORY.md` holds sessions 1–15 verbatim — reach for it when you need the reasoning
behind an older decision, not for current status (several statuses in there have rotted; the
audit banners in `WORK_TO_BE_DONE.md` are the correction).

## Current state

- **Backend Phases 0–4 substantially built** (colleague merged Phases 1–2; Phase 3
  Fleet/WMS/HR built here). Tests + lint green.
- **Frontend reskinned to the Lovable "Control Tower" look**, keeping the existing
  client's working plumbing (auth, api-client with refresh-on-401, branding, theme,
  screen-registry). Approach chosen with the user: *functionality of the existing
  client, looks of Lovable.*
  - `client/src/index.css` — Lovable design tokens (orange `#F5821F` + blue `#1C9BD7`,
    off-white/navy palette, Playfair Display + Montserrat, mesh backdrop) mapped onto
    the existing semantic tokens, so every screen re-tints automatically. Signature
    classes: `lux-card`, `status` pills, `lux-topbar`, `lux-mark`, `lux-navlink`,
    `font-display`. Now also carries a `landing-*` / `login-*` block (cinematic hero +
    dark sign-in modal, fully `--primary`-driven) and `.shadow-l` + `.lux-sidebar-in`.
  - `client/index.html` — Google Fonts links.
  - `client/src/app/layout/app-shell.tsx` — glass top command bar. **Navigation lives in
    the top bar:** primary areas inline (Control Tower link + Finance/Warehouse/Fleet
    dropdowns that open on hover with a 180 ms grace + click/tap/keyboard), a **More** button
    opens the full **15-group** menu as a collapsible **overlay sidebar** (ESC / outside-click
    to close). The old persistent left rail is gone; content is full-width. Mobile hamburger
    opens the same sidebar. **Real ⌘K command palette** (`components/command-palette.tsx`)
    filters all NAV screens. **Mobile bottom nav (session 2):** `BottomNav` (Control Tower /
    Files / Finance / Search), `flex md:hidden`, active-by-route-prefix, Search opens the
    palette. **LIVE/TEST toggle** kept (flips `X-Praxis-Env` and reloads — see the logout gap).
  - `client/src/features/dashboard.tsx` — Control Tower home renders the **full Lovable
    mock** in an isolated `<iframe srcDoc>` from `client/src/features/dashboard-mock/*.txt`.
    The mock's own topbar is hidden so there's a single app chrome; the iframe's
    `data-theme` tracks the app's light/dark via a MutationObserver.
- **Pre-auth experience rebuilt (2026-07-13): cinematic landing → login modal.**
  - `client/src/features/landing/landing-page.tsx` (NEW) — the `/login` route now renders
    a full-bleed dark hero (ken-burns bg, logo + theme toggle, eyebrow, serif headline,
    subheadline, italic body, brand chips, **Enter workspace** button). Fully white-label.
    **Content source (session 2):** reads the saved login config via `fetchLogin()`
    (`GET /branding/login`) first — headline / subtext / backgroundUrl / showLogo /
    accentOverride / layout — then falls back to legacy `branding.hero`, then generic copy.
    Every accent is `--primary` (token-driven); `accentOverride` scopes `--primary` to the hero.
  - `client/src/features/auth/login-modal.tsx` (NEW) — "Welcome back / Sign in to your
    command center" modal over the dimmed hero. **PASSWORD | QUICK PIN** tabs, email +
    password (reveal), keep-me-signed-in, forgot-password, SIGN IN; the existing **2FA**
    step is retained after password. Quick PIN is a **UI stub** (no backend endpoint yet).
  - `client/src/features/auth/login-page.tsx` — now a thin re-export of `LandingPage`
    (superseded; old standalone login removed).
  - `client/src/lib/branding.ts` — `Branding` extended with an optional `hero` block
    (eyebrow / headline / subheadline / body / imageUrl / pills[]) + `BrandPill`.
    `uploadLogo` renamed to `uploadImage` (alias kept).
  - `client/src/features/settings/appearance-page.tsx` — new **"Landing page"** card to
    edit all hero fields, upload the background image, and manage brand chips; saves via
    the existing `PUT /branding` flow and applies live.
  - **Keep-me-signed-in is real:** `client/src/lib/token-store.ts` now stores the refresh
    token in `localStorage` when checked (survives restart) or `sessionStorage` when
    unchecked (gone when the tab closes); `auth-context.login(email, pw, keepSignedIn)`
    threads the choice (also covers the 2FA path).
- **Phase 0 + Phase 1 FE wired to live endpoints.** Finance screens in
  `client/src/features/finance/pages.tsx` (Chart of accounts, Journals, Proforma &
  advances, Invoices, Receivables, tabbed Statements, tabbed Tax center, Assets), routed
  in `client/src/app/app.tsx` + nav + `client/src/app/screen-registry.json`. HR
  Employees/Payroll wired by colleague. Finance write forms (post/reverse journal, record
  advance, invoice draft→edit→submit, period freeze/close) via `ui/modal.tsx` +
  `lib/finance-api.ts`.
- **Auth behaviour:** logout `localStorage.clear()`s everything — nothing persists across
  sign-out (until told otherwise).
- **Postman** `postman/praxis-ls.phase0.postman_collection.json` — Phase 0 + Finance +
  Fleet/WMS/HR folders.

## Session log — 2026-08-02 (session 19b: the approval engine made to enforce; the organigramme wired)

**A parallel stream to session 19, merged 2026-08-02.** Where the two overlapped, see §9.

**VALIDATION:** backend green in-sandbox (lint 0 errors, migration-number guard clean, ~40 assertions
across purpose-built harnesses plus the existing executor suite replayed for regressions). **The client
build passed on Windows** mid-session and again after the last FE batch — but ~25 frontend files changed
after that second pass, so **`npm run build --prefix client` is still owed**. `tsc` never completes on the
sandbox mount (it runs past three minutes), so no FE change here was typechecked by me.

**Started as an audit** — `doc/ORGANOGRAMME_AUDIT_2026-08-02.md`, which is the reference for all of this
and carries file+line evidence. "Organogramme" resolved to three different things, and the business meant
the approval hierarchy.

1. **The finding: the approval chain routed notifications, not authority.** `workflow_step` binds a step
   to a role, a capability, **a scope** and an amount band. The executor honoured exactly one of those —
   the amount. `createTask` dropped role and scope; `act()` verified only that the task was still PENDING.
   So anyone past the route gate could clear any task at any step of any document, including one they
   raised. Three structural facts made it unenforceable rather than merely under-enforced: the step
   designer collected `capability_code` and the amount band (the two fields the engine ignored) and had
   no input for `role_id` or `scope_id` (the ones it used); every approvable document kept a direct
   approve route, exposed as a button; and `user_scope` was **written nowhere in the codebase**, so no
   user was ever in a scope.

2. **`executor.act` now checks the actor.** Role and scope must both match (business decision: a step
   names both, null = unrestricted), the capability if the step names one, and `step_kind` against the
   verb. **Maker-checker is enforced for everyone including the CEO** — the requester was already
   resolved, and used only to decide whether to send a notification. Deliberate departure from the CEO
   RBAC bypass; on a tenant where one person is the only approver *and* the only requester this WILL
   block, which is the control working.

3. **Scope resolves as a CLOSURE** (`identity-cache.getUserScopeClosure`) — a manager at HQ can act on
   DLA beneath it. Using raw `user_scope` rows would have made assigning a regional manager to HQ hide
   every branch from them, which is why `parent_scope_id` existed and never did anything.

4. **`approval_task.module_key` (`0488`)** — approving a payroll run required `approve` on **MOD-67, the
   IAM module**, seeded to CEO only. Now per-task, resolved from the owning module. Stored rather than
   derived from the entity_ref prefix so it can't drift from `on-approved.js`'s handler map.

5. **The bypasses close while a chain is live** (`services/workflow/pending-guard.js`) — the seven direct
   transition routes 422 with `APPROVAL_PENDING`. Narrow on purpose: they refuse only while a task is
   PENDING, so a document with no bound workflow still has a path. **W8 is resolved by this, not by
   auto-finalising** — I built auto-finalise first and reverted it: for supplier invoices it posted to the
   general ledger because nobody had configured a workflow. An ERP must not infer authorisation from
   missing configuration. Reasoning is in `purchase_order.service.js`.

6. **The organigramme is wired.** `user_scope` got endpoints and an assignment UI; Security → Scopes has
   an **Organigramme** tab (`components/organigramme.tsx`) flagging nodes with nobody in them; the step
   designer got role and scope pickers. `scope.validator` was `passthrough` — now shaped, with a cycle
   guard (`assertNoCycle`), which matters because the tree is walked now.

7. **Departments became scopes (`0490`).** "Department" was free text typed into three unrelated forms
   with no table behind it, and `employees.repo` matched it with `=`, so "Operations"/"operations" were
   two departments each returning half the staff. `scope_id` added to `employee`/`vacancy`/
   `purchase_request` with the text kept as a display snapshot (the `0477` pattern), one shared resolver
   (`shared/rbac/department-scope.js`), one shared picker, and the vacancy→employee hire path now carries
   the reference instead of copying a typed string. **No FK, deliberately** — same reason as `0489`.

8. **Purchase requests joined the engine (`0491`)** and **`0492`** repairs the default workflows `0469`
   seeded then swallowed (`EXCEPTION WHEN OTHERS THEN NULL`). Renumbered from 0487 in the merge; it is
   idempotent so the re-run inserts nothing.

9. **Merge with the parallel session 19.** Both streams enforced `depends_on` independently — **theirs
   won**, and mine had two bugs my unit tests couldn't see because they used synthetic data:
   `depends_on` is `citext[]`, which node-postgres returns as a raw string (mine called `.find()` on it),
   and I set `source: "dependency"`, which the `feature_state.source` CHECK forbids. Kept from mine: the
   log line naming what was forced off and why. Their `requireCapability` call sites (audit finding W7,
   solved from their side) are complementary to the per-target-state permission map — combined via
   `requireTransitionCapability`, so APPROVER is demanded for decisions and **not** for submissions,
   which would have been the same bug one layer up.

10. **Four permission bugs found by testing as a non-CEO user**, all pre-existing, all invisible to CEO
    testing — see the new rule above and `doc/PERMISSION_SWEEP_BACKLOG.md`. Plus: **the permission matrix
    was silently wiping grants.** `GET /permissions` paginates at 50; the matrix loaded every role and
    module but only the first page, so a cell whose grant was below the cut rendered empty and clicking
    it PUT an all-false row over the top. New `/permissions/matrix` returns the set unpaginated.

11. **`A5` — DELETE was a no-op across 32 modules.** `makeService` gained `deleteMode`; the five RBAC
    config tables now really delete (still recording `soft_delete`, so restore and maker-checker survive),
    and sessions return **405** pointing at `/sessions/:id/kill` rather than reporting success.

12. **Screen registry 59 → 96.** It is the AI's map of the product (`services/ai/knowledge/codebase.js`)
    and was missing all of Operations, Sales, Commercial, Costing, Procurement, Vault and AI Control.

13. **20 silent frontend handlers now report.** `try {} finally {}` with no `catch` is how the
    milestone-advance 422 hid for weeks and how a 403 on Submit presented as "submit not working". A
    shared reporter + a banner in the app shell made each retrofit one line; `lib/use-action.ts` is the
    better pattern for new code.

14. **B1 — the reporting line (`0493`).** `0490` answered WHERE someone sits; this answers who reports to
    whom. `employee.reports_to` with a REAL foreign key (same table, same schema, so unlike the scope
    references it is satisfiable under TEST), `ON DELETE SET NULL`, a CHECK against self-management and a
    service-side walk for deeper loops. `directReports` / `teamOf` (recursive) / `managerChain` — the first
    is what `is_line_manager` ("approves for own team") has never been able to resolve, the last is the
    escalation path W13 will read. Reads are field-masked like every other employee read, so a team list
    can't become a way around salary visibility. **Not** added: a position table — `job_title` is still
    free text with the same weakness `department` had, but that is separate master data.

15. **Auth — a live complaint, two fixes.** See `doc/AUTH_SESSIONS.md` for the whole model and the traps.
    - **The app never recovered from a failed refresh.** `api()` tried one refresh on a 401 and, when it
      failed, fell through and threw — no token clear, no state change. The app kept believing it was
      signed in while holding a dead token, so every action reproduced the same "token expired" banner and
      only a manual sign-out cleared it (exactly what users reported). The boot path had always handled
      this; mid-session never did. Now `endSession()` fires `SESSION_ENDED_EVENT` and auth-context returns
      to the login screen. **Tell, if it regresses:** a page reload fixes it but signing out is needed.
    - **"Keep me signed in" now means it (`0494`).** The checkbox persisted the refresh token for 30 days
      while the server killed the session after 30 minutes idle. Recorded on `user_session.keep_signed_in`
      and honoured in `refresh()`; rotation, reuse detection and remote kill still apply. **Trap:**
      `zValidate` replaces `req.body` with the parsed object and `z.object()` strips unknown keys, so the
      flag had to be declared in the login / 2FA-verify / PIN-login schemas or it would have been silently
      dropped and the feature would have looked implemented while doing nothing.
    - **Left alone, deliberately:** `last_seen_at` is written ONLY by `touchSession()` inside `refresh()`,
      so the "inactivity" clock actually measures time-since-last-refresh. It is correct today only because
      `JWT_ACCESS_TTL` (15m) < `SESSION_INACTIVITY_MIN` (30). **Raise the access TTL past 30 minutes and
      every non-keep-signed-in user is logged out mid-work.** Two settings that look independent and are
      not — `doc/AUTH_SESSIONS.md` Trap 1.

16. **`scripts/tenant/permission-report.js`** — compares a tenant's grants against the seeded baseline
    (parsed from the seed files, so it can't drift) and reports MISSING / REDUCED. Written because the
    matrix-pagination bug may have silently revoked grants, and a 70-column grid is not something you
    audit by eye.

**Migrations to run:** tenant **`0488`**–**`0494`**; seeds **`9022`** (grant gaps) + **`9130`** (MOD-72
mail). **Owed:** `npm run build --prefix client`, `npm test` on Windows, and a **non-CEO** click-through —
`doc/APPROVAL_VERIFICATION.md` is the script.

**Known unfinished:** B2–B4 (no position table; `job_title` still free text), W13 (delegation, escalation,
deadlines — the data now exists via `managerChain`, the behaviour doesn't), C7 (`portal.*` gates the staff
preview but not the external surface it exists to control), and the `last_seen_at` coupling above.

## Session log — 2026-08-02 (session 19: three RBAC/finance gaps closed — depends_on enforcement, capability assignment + gate, AssetsPage write UI)

**⚠️ VALIDATION STATUS: NONE (sandbox VM down — "Not enough disk space").** No `tsc`/`eslint`/`jest`/`vite build`
ran. Windows validators are the gate. Backend changes are plain CommonJS; the FE touch is `finance/pages.tsx`
+ `finance-api.ts` + `security/pages.tsx`. New tenant migration **`0487`** to run.

0. **⚠️ POSTMORTEM — the first cut of point 1 caused a production outage; fixed.** `depends_on` is a
   **`citext[]`**, and node-postgres has no array parser for the extension type, so it returns the raw literal
   **string** (`"{}"`, `"{accounting.core}"`) not a JS array. The initial `enforceDependencies` did
   `for (const dep of f.depends_on)`, which iterated that string character-by-character — `"{"` is not a feature
   key, so **every** feature, including no-dependency anchors, was forced off, and the deploy's re-projection
   turned all gated modules dark for every tenant (403 FEATURE_DISABLED everywhere). Fix: the query now casts
   `fc.depends_on::text[]` (which the driver parses) and a `toDepsArray()` normaliser makes the function correct
   whether handed an array or the raw literal. Regression tests added for the string form. The unit tests missed
   it originally because they passed JS arrays, not the driver's actual return shape. **Recovery = redeploy the
   fix; the migrate service re-projects all tenants correctly.**

1. **`depends_on` is now enforced at projection time.** `projectFeatures()` resolved each feature's state
   (override → plan default → off) and wrote it verbatim, never consulting `feature_catalogue.depends_on` — so a
   child could be entitled with its parent off (the session-10 "19 modules dark" bug one layer up;
   `ai.assistant.backend`/`ai.vectorization` both declare `{ai.assistant}`). Added a pure
   `enforceDependencies(features)` in `provisioning.service.js` (exported + unit-tested,
   `tests/unit/feature-depends-on.test.js`): a feature stays `on` only if every key in its `depends_on` is `on`,
   applied to a **fixpoint** so a broken dep cascades through a chain, and an **unknown** dependency counts as
   unmet (can't be satisfied → off). The resolved `source` is preserved (the tenant `feature_state.source` CHECK
   only allows plan|override|default) while `state` flips to off — no migration needed. Runs on every
   projection, i.e. every deploy.

2. **user↔capability assignment built — the writer `user_capability` never had.** `requireCapability` (the SoD
   gate: ISSUER/VALIDATOR/APPROVER/LINE_MANAGER) was fully built and mounted **nowhere**, because nothing could
   assign a capability to a user (catalogue seeded, `user_capability` had no INSERT anywhere). Mounting the gate
   without this would have 403'd every non-CEO approver with no recovery. Added to the capability module:
   `repo.userCapabilities` / `repo.setUserCapabilities` (blanket rows keyed on the `document_type='*'` sentinel —
   the PK is `(user_id, capability_id, document_type)` so document_type is implicitly NOT NULL; requireCapability
   ignores doc-type/thresholds so '*' reads as global), `service.setForUser` (replace-all; invalidates the user's
   identity cache via **`invalidateUser`** because caps live under `identity:caps`, which `invalidateGrants` does
   NOT clear; emits **`role.changed`** — seeded security-critical — for Watch-the-Watcher, not `capability.updated`
   which isn't), and routes `GET|PUT /capabilities/users/:userId` (before `/:id`; PUT gated `approve`). FE: a
   Capabilities chip selector on the user edit/create form (`security/pages.tsx`).

3. **`requireCapability('APPROVER')` mounted on the two highest-authority costing routes** — cash-request
   **disburse** (`MOD-49`) and costing **status** (`MOD-46`). CEO bypasses. **`0487_approver_capability_backfill`**
   grants blanket APPROVER to everyone who already holds the approve grant on those modules via their roles, so no
   existing approver is locked out on deploy; new users must be granted it explicitly (the SoD win). Tests:
   `tests/unit/capability-assignment.test.js` (gate CEO-bypass/403/allow/LINE_MANAGER/no-context + repo + service).

4. **AssetsPage is a real screen now, not a `ResourceList` stub.** `finance/asset/` (MOD-54) was a complete
   backend — create (builds the monthly schedule), `/:id/depreciate` (posts one period's dotation, idempotent),
   `/:id/dispose` (gain/loss vs NBV) — behind a read-only list. Built the create form, a per-period Depreciate
   action, a Dispose form (shows NBV + gain/loss), and a detail modal with the depreciation schedule + per-row
   **Post** buttons, all via new helpers in `finance-api.ts`. Removed the now-unused `ResourceList` import
   (TS6133 would fail CI).

5. **Self-grant maker-checker block implemented — the `permission.service.js:9` TODO is closed.** The documented
   rule (DB_ARCHITECTURE §108) is "a Super Admin cannot self-grant Issuer/Validator/Approver", i.e. it is about
   the **capability** overlay, which only became assignable via the writer built in point 2. `setForUser` now
   rejects (403 `SELF_GRANT_FORBIDDEN`) a user **adding** a restricted authority (ISSUER/VALIDATOR/APPROVER) to
   **themselves** — keeping or removing one a *different* admin granted, and clearing the set, stay allowed; a
   diff against current holdings, not a blanket ban. The TODO's `req.env` dependency was moot: capabilities are
   identity data pinned to the live schema, so the block is unconditional (there is no sandbox authority set to
   exempt). The permission role×module matrix is deliberately untouched — the rule names the authority overlay,
   not the CRUD grants. The old TODO comment is replaced with a pointer to the implementation. FE surfaces the
   specific message (the user form special-cases the code, since `errMsg` flattens every 403).

6. **xlsx/csv report export wired — the toolkit finally has a consumer.** The ExcelJS/CSV service existed but
   nothing called it; scheduled reports emailed raw JSON in a `<pre>` and ignored `formats`. Added
   `report-export.js` (a generic `tabulate()` that projects any report producer's data — flat row arrays,
   `{rows,…}` wrappers, or nested statement objects flattened to Field/Value — into the toolkit's
   `{columns,rows}` contract, plus `toExport()` → csv/xlsx buffer). On-demand endpoint
   `GET /reports/run/:key/export?format=csv|xlsx` mirrors the existing `/pdf` route; FE gained **Export CSV/XLSX**
   buttons on the run panel (via a new authed `download()`/`tenantDownload()` blob helper — a plain `<a href>`
   can't carry the Bearer token). Scheduled reports now render each requested csv/xlsx format and **attach** it
   (base64 through the email job, which now forwards `attachments`); pdf keeps its inline body (its vaulting path
   is separate). Tests: `report-export.test.js`. Not done: bespoke per-statement layouts (nested statements
   export as Field/Value, honest but not the DGI liasse), and pdf-as-attachment for schedules.

**Migrations to run:** tenant **`0487_approver_capability_backfill`**.
**Owed (Windows):** `npm run lint`, `npm test`, `npm run build --prefix client`. Verify by hand: a non-CEO with
the disburse grant but no APPROVER is now 403'd on disburse until granted the capability on the user screen; a
fresh projection leaves `ai.assistant.backend` off while `ai.assistant` is off; a Super Admin cannot tick
APPROVER on **their own** user row (403) but can on someone else's.

7. **Auditor room built + IFRS question closed.** Disclosure policy chosen and implemented in
   `portal.service.auditorView`: OHADA statements + trial balance + procurement + a period-scoped
   general-ledger/document **audit trail with the acting user named**, drawn through
   `repo.auditLedger` whose allow-list (`split_part(action,'.',1) ∈ finance/procurement/costing/document`)
   makes HR, payroll, permission/role and God-Mode events unreachable no matter what event a new module adds;
   document files stay behind the gated vault download. PRD Q4 resolved **OHADA** — `investorView` keeps
   `basis:"OHADA"` and gains net-margin/expense-ratio KPIs. Tests in `portal.test.js`. **FE built too:** the
   external `/client-portal` SPA now has a live **Audit room** terminal (statements + trial balance + a named
   audit trail) — `AuditorTerminal` in `portal-app.tsx`, `portalAuditorView()` in `portal-api.ts`; `PortalHome`
   now routes all three grants generically (the old "audit room isn't open yet" placeholder is gone).

**Still open:** `scopeColumn` record-level adoption (needs the entity-level design call — see the suggestion in
this session's chat: reuse `entity_id`, opt-in per table, enforce list+detail).

## Session log — 2026-08-02 (session 18: TEST-mode writes fully fixed — sandbox user mirroring moved to user create)

**Small session, one thing.** Closed the item session 17 left open, and found a second hole in the same
mechanism that had never been recorded.

1. **The mirror was running at one moment, not continuously.** Session 17 copied `live.app_user` into the
   rebuilt sandbox at the end of `wipeSandbox`. Correct, insufficient — mirroring at wipe time leaves
   **(a)** a newly provisioned tenant with an empty sandbox (provisioning runs before `create-admin.js`, so
   there is nothing to copy — the known gap), and **(b)** *any* user created after the last wipe missing on an
   otherwise-healthy tenant — the drift case, which nobody had identified. Not hypothetical: the backfill found
   **2 such users on smartls**, so the deployment was already broken by a route the docs didn't describe.
   Both produce the same 23503 "Referenced record not found" on the first TEST-mode write, after the business
   row has already committed.

2. **`src/shared/db/sandbox-user-mirror.js`** (new) — `mirrorUsersIntoSandbox(client, {userId})` (throws) and
   `mirrorUserBestEffort` (swallows + warns). Schemas named **explicitly** rather than trusting `search_path`
   (callers arrive set to whatever they were working in); `ON CONFLICT DO NOTHING` deliberately **untargeted**
   so it absorbs an `email` clash as well as a `user_id` one, with a post-check + warn on the single-user path
   because an email collision is the one case where "nothing inserted" still leaves the FK unsatisfied; a
   `to_regclass` guard so it no-ops mid-wipe instead of erroring inside a user-create request. Same column set
   as before — **no `employee_id`** (references `sandbox.employee`, emptied by a wipe), no TOTP secret, no
   godmode pin.

3. **Call sites:** `wipeSandbox` (delegates now), `provisioning.createAdmin` + `scripts/tenant/create-admin.js`
   (**this is what closes the fresh-tenant hole**), `app_user.service.createUser` (after COMMIT, best-effort —
   a sandbox problem must never fail a live user create) and `updateUser` (**self-heal for pre-fix users, not a
   sync** — the untargeted conflict means a renamed user keeps the old display name in sandbox; cosmetic).

4. **`scripts/tenant/mirror-users.js`** (new) — `--slug=<x> | --all [--dry-run]`. Idempotent, read-only against
   LIVE, counts missing before/after and names what it could not mirror rather than reporting success.
   `tests/unit/sandbox-user-mirror.test.js` — nine cases.

4b. **Deploy covers it.** `migrateTenant()` mirrors after `projectFeatures()`, so `scripts/deploy.sh`'s migrate
   service (platform + all tenants, every deploy) self-heals drift on **every** environment — no manual step to
   forget. Best-effort: a deploy must not fail over sandbox convenience data, so a failure logs at error level
   and the script re-runs it on demand. The manual script is now for ad-hoc/local use, not a release checklist
   item.

5. **Validated (user-run on Windows):** lint + test clean, `--all` → `smartls: mirrored 2 of 2 missing
   user(s)`, and a TEST-mode write with a real actor confirmed in the UI. **TEST mode is writable for the
   first time since session 3.** `migrateTenant` (the deploy-path mirror) was re-validated in the same pass.

6. **AI memory stopped forgetting (`0481`).** Rolling summary on `ai_conversation` — everything that scrolls
   out of the 20-message replay window is folded into one ≤200-word summary, **replaced not appended** (an
   appended summary recreates the cost problem the window exists to solve), regenerated in batches of 10
   (every turn would double the cost of a long thread). Bounded, documented **gap**: up to nine messages sit
   outside both window and summary until the next batch. Runs before the model call so the current answer
   benefits; `summary_through` advances only on success; redacted on the way in; billed with
   `call_type='summary'` because it is real spend.

7. **`/media` made safe under S3 — before the switch, not after.** The gated download route was already
   correct (`document_vault.service:71` streams via `storage.get`). The actual hole was **`storage.publicUrl`
   minting a direct bucket URL for ANY key**, including the vault PDFs `pdf.service.renderAndStore` puts
   through it — persisting that is how a confidential doc gets a link that bypasses `requirePermission`. Now
   `publicUrl` returns `/media/<key>` for everything (CDN for public keys only) and `/media` is mounted under
   **both** drivers with the same allow-list, answering a permitted key under s3 with a **302 to a 5-minute
   presigned URL**. **The bucket needs no public-read at all**, and a stored URL survives a local→s3 move.
   New shared `isPublicStorageKey()` so key and path can never disagree.

8. **External CLIENT PORTAL built (`0482`) — the first external user who can actually sign in.**
   `portal_access` grants by **email**, `portal_user` holds credentials, and nothing connected them:
   `POST /portal/users` had **no caller**, so every grant ever issued pointed at somebody with no password.
   Third instance of the service-type shape. New `0482_portal_invite` (one-time tokens, SHA-256 hash only,
   single-use; **INVITE 7 days vs RESET 30 min** — an invite reaches someone who may open it days later),
   `inviteUser`/`requestReset`/`acceptInvite` + `POST /portal/auth/forgot|accept` and
   `POST /portal/users/invite`. FE at **`/client-portal`, NOT `/portal`** — the staff grant screen owns
   `/portal/access` and an auth boundary must not rest on React Router's route ranking. Own token store and
   fetch client (`lib/portal-api.ts`), sessionStorage, no refresh, outside `RequireAuth`/`AppShell`. Staff
   grant modal now creates the login too (separate, non-fatal step — SMTP must not roll back a grant), and
   rows show **"no sign-in" / "invited"** badges with Create-sign-in / Resend. Logins matched to grants
   **client-side** because `portal_access` is env data and `portal_user` is identity data — no cross-schema
   join. **Investor terminal built too** (PRD §5.2): `investorView` now returns income statement + bilan +
   cash position + TAFIRE plus derived KPIs, with a **default period** — the producers sum the entire ledger
   when given no `from`/`to`, which makes a meaningless inception-to-date income statement — and
   `basis: "OHADA"` in the payload, since PRD open question 4 (IFRS view) is unanswered. KPIs derive from the
   statements already fetched so "revenue" cannot drift from the Compte de résultat beside it. An unbalanced
   bilan is **shown, not hidden**. **Auditor room still NOT built** — `auditorView` is a placeholder, and the
   blocker is policy not code: the immutable ledger carries staff names, HR events and permission changes, so
   somebody must define what an external auditor may see before it is composed.

9. **Re-audited the open list against source** (detail + line numbers in `WORK_TO_BE_DONE.md`, "Repo audit —
   2026-08-02"). Four corrections: the **xlsx/csv export is half-built** — `services/spreadsheet.service.js`
   + `services/excel/workbook.js` exist, are house-styled, and have **zero consumers**, so the gap is wiring
   plus a non-PDF job handler (`jobs/workers.js:25` registers `pdf` only), not authorship; **Help center is
   built and routed** at `/help`, only the settings tile is `<Planned/>` (factory languages is the genuinely
   unbuilt one); **two session-10 chores were never done** — `client/vite.config.js` still shadows
   `vite.config.ts` and `features/master/pages.tsx` still has zero importers; and **`depends_on` is concrete**
   — `ai.assistant.backend`/`ai.vectorization` both declare `{ai.assistant}` and nothing enforces it. Also
   missed by the 08-01 audit: **`AssetsPage` is still a `ResourceList` stub** (`finance/pages.tsx:1120`)
   behind a complete `finance/asset/` backend.

## Session log — 2026-08-01 (session 17: Control Tower map made real, /media bypass closed, milestone auto-seeding, AI memory, doc-truth audit)

**⚠️ VALIDATION STATUS: NONE.** The sandbox VM failed to start for most of this session, so no `tsc`, no
`eslint`, no `jest`, no `vite build` ran against any of it. `client/src/features/dashboard.tsx` took the most
churn by a wide margin (map rebuild + panel fixes + a large block deleted when geometry moved to the parent).
Windows validators are the gate. `npm install --prefix client` is REQUIRED first — two new deps.

1. **Repo audit (do this before trusting any status in these docs).** Several backlog entries were years-stale
   in spirit: payroll, asset depreciation, `approval_task` auto-creation, `notification` self-scoping, the
   gated vault download, the AI spend dashboard, HR onboarding/succession, the LIVE/TEST toggle and the
   platform console were all **built** while marked `[ ]` or "deferred". Flipped in `WORK_TO_BE_DONE.md` with
   file+line evidence. Still genuinely open: `scopeColumn` (no business table has a scope column, so adoption
   is blocked, not skipped), `requireCapability` (zero call sites), `depends_on` (never consulted by
   `projectFeatures()`), the Live self-grant block (`permission.service.js:9`), xlsx/csv report export (the
   validator accepts them; only `pdf-render.js` exists), factory languages, external portal FE.

2. **Live-shipments panel — three defects, all making it show less than the BE already sent.**
   (a) `toLiveShipment` read `s.route ?? s.lane`; the payload carries `origin`/`destination` (`dossier.pol`/
   `pod`), so `from`/`to` were always "" and every row drew a bare "→". (b) ETA went in raw
   (`2026-07-16T23:00:00.000Z`) → `dateFmt` (it's a DATE column; the midnight-UTC time was a serialisation
   artefact). (c) `prog: Number(s.progress ?? s.prog ?? 0) || 45` — no progress field was ever sent, so every
   row landed on the literal **45**, and an OPEN dossier looked as advanced as one nearly delivered. Progress
   now comes from `milestone_instance` using the **same correlated subqueries as `operations_file.repo.js:32-34`**
   (deliberately identical so the Control Tower bar and the Operations list can't drift) and is **null** when
   a dossier has no chain → the bar hides. Status pill `enumLabel`'d. Mode from `service_type.key`, not text
   sniffing, which had drawn `HINTERLAND_TRANSIT` (no vessel, two ordinary city names) as a sea lane.

3. **The map.** Was hand-drawn artwork with three hardcoded lanes. **No coordinate data existed anywhere** —
   the only lat/long in the tenant schema is the HR geofence (`0465 work_site`/`attendance_log`), which is the
   tenant's own offices, not ports. `dossier.pol`/`pod` are bare `text`.
   - **`0478_geo_place.sql`** — `query_key` is normalised (case, accents, apostrophes, punctuation) so
     `N'Djamena`/`Ndjamena`/`NDJAMENA` are one row; `name` keeps display spelling; `source` is
     `SEED|GEOAPIFY|MANUAL` so a hand-correction can be found and is never overwritten by a later geocode.
     24 seeded places. Genuinely idempotent (`DROP TRIGGER IF EXISTS` before create) unlike most tenant files.
   - **`operations/geo_place/`** — full module. **Rides MOD-29 on purpose**: `requirePermission` resolves
     grants by `module_key`, and a key absent from `platform.feature_catalogue` has grants for nobody, so a
     new key would 403 every non-CEO user.
   - **`geoapify.service.forwardGeocode`** — the integration existed but was **reverse-only** (`/geocode/reverse`,
     consumed solely by HR clock-in). Same key resolution, timeout and never-throw contract as the reverse call.
     Resolution is cache-first and writes misses back; misses are geocoded **sequentially** because a parallel
     burst is the fastest way to trip the 3,000/day free tier.
   - **FE** — Natural Earth 110m (`world-atlas` + `topojson-client`), projected **in the parent** and passed to
     the iframe as SVG path strings (the iframe can't import modules; doing the fit once also means land,
     graticule, lanes and nodes cannot end up on different projections). Auto-fits the viewport, fans clustered
     lanes to alternate sides, nudges colliding labels with leader lines. **Known limit:** a lane crossing the
     antimeridian (±180°) would tear — no Douala-centred route does; noted in the code.
   - **`0479_dossier_place_refs.sql`** + `SearchSelect` pickers on the dossier form (free-text fallback kept, so
     an unlisted port is never blocking). Ports resolve **at dossier save**, not at map render — the old
     trigger meant a port on a dossier nobody opened on the dashboard was never catalogued, and even when it
     was, nothing linked the dossier to the row its own text had just created.

4. **`/media` was an authentication bypass.** `express.static` covered the whole `STORAGE_LOCAL_PATH` root,
   which also holds `tenant_<slug>/vault/…` — so `GET /documents/:id/download` (`requirePermission`) could be
   walked around by anyone who knew or guessed a key. `shared/http/media-guard.js` is a deny-by-default
   allow-list: `branding`/`login`/`entity`/`avatars` stay public (logo + login background must load pre-auth),
   everything else 404s. Traversal is rejected explicitly — `tenant_x/branding/../vault/doc.pdf` never leaves
   the root, so `express.static`'s own protection doesn't catch it and a second-segment check alone would pass
   it. 404 not 403, so a probe can't distinguish protected from absent. `tests/unit/media-guard.test.js`.
   **Judgement call:** `avatars` left public (rendered as plain `<img>` from `app_user.avatar_ref`); revisit if
   a tenant treats profile photos as personal data. **S3 note:** this guard is local-driver only — under
   `STORAGE_DRIVER=s3` the same split must be enforced by bucket policy.

5. **Branding stopped being per-environment.** It read through the env-scoped `req.tenantDb`, so appearance was
   stored in `live.setting` AND `sandbox.setting` with neither aware of the other: `wipeSandbox`'s
   `DROP SCHEMA sandbox CASCADE` (`provisioning.service.js:210`) destroyed the TEST copy on every wipe, and a
   LIVE copy was invisible in TEST. Now **live is the base, sandbox may override** — reads take live and
   overlay only what sandbox explicitly sets; writes go to the current env. Palette experiments still possible,
   wipe only ever discards a deliberate one. Applied to the login-screen config too. Separately: the appearance
   editor rendered every unset token as `#000000` and Save posts whatever the inputs hold — one click on an
   unconfigured form would have persisted black as the brand palette. Fallbacks are now the real `index.css`
   values.

6. **Milestones.** Instantiation was a manual call nobody made (the seed did it for 1 dossier in 5; no screen
   ever called `POST /milestones/instantiate`). Now **auto-seeded on dossier create** — after the transaction
   commits, because `milestone.instantiate` opens its own `BEGIN/COMMIT` and nesting would close ours — and
   best-effort, so a missing template never fails a create. `instantiateMilestones()` added as the escape
   hatch. Seed gained templates for **air** and **hinterland transit** (only sea had one, so those dossiers
   could not be instantiated at all — `422 NO_TEMPLATE`) and chains on all five dossiers at 40/100/20/60/0%
   (0% deliberately proves a real zero renders a bar where a missing chain renders none), with `completed_at`
   set on DONE stages. **Found: `advanceMilestone` never sent the required `to`** (`milestone.validator.js:7`),
   so every milestone advance from the UI had been returning 422 — that button has never worked.

7. **AI conversation memory.** `ai_conversation`/`ai_message` existed since `0400_ai.sql` and **nothing ever
   wrote to them**: `orchestrator.ask` built `[system, user]` every call, so each question was the model's
   first. Now one rolling thread per user (resolved server-side; the client needn't track an id), **last 20
   messages replayed** with everything stored indefinitely — the cap bounds per-call token cost, which matters
   because AI spend is budget-capped. History is `redact()`ed on replay like live input, saved **after** the
   model call (no orphan question replayed forever with no answer), and best-effort throughout. `GET /ai/history`
   + `POST /ai/history/clear` (clear starts a NEW thread — deleting would strip the `ai_action_run` audit trail,
   which references `conversation_id`). Executed actions append a factual assistant note, so the assistant knows
   what it **did**, not only what it proposed. Fixed: action runs recorded `conversation_id` from a request
   field the copilot never sent, orphaning every one. **Known limit:** no summarisation, so turn 21 doesn't
   fade — it vanishes.

8. **CI.** `npm audit --audit-level=high`, a secret scan (deliberately not matching the `__rotate_me__`
   placeholders), a **duplicate-migration-number guard** (`scripts/db/check-migration-numbers.js`), and a
   **frontend job** building `client` + `platform-console` — neither had ever been built in CI, so a FE type
   error could merge green. **On the collisions:** `0470_regie_doc_number`/`0470_seed_ai_vendors` and
   `0475_hr_discipline_and_avatar`/`0475_master_email` are **grandfathered, not repaired.** The migrator keys
   on **filename**, so renaming an applied migration makes it re-run — and tenant migrations are not written to
   be idempotent (23 files use a bare `CREATE TRIGGER`, which fails `42710` on a second run). **Never renumber
   an applied migration.** The guard fails only on NEW collisions.

9. **Fresh-tenant walkthrough (second half of the session) — run against a WIPED sandbox.** Everything below
   came out of trying to get from an empty environment to a working dossier without touching the database.
   **It succeeded in the end**: service type → milestone template → corporate entity → client → dossier, with
   the dossier arriving with a live milestone chain, a progress bar and a plotted map lane.
   - **⚠️ TEST-MODE WRITES BROKEN SINCE SESSION 3 — the most important finding here.** Identity pinned to LIVE
     (`req.identityDb`) vs business writes on `req.tenantDb` (sandbox), and **60+ columns typed
     `REFERENCES app_user(user_id)`** between them → **23503** on any actor column, *after* the business row
     had already committed. Hidden for fourteen sessions because `sandbox.app_user` kept its provisioning
     rows; the first `DROP SCHEMA sandbox CASCADE` exposed it. **Fixed by mirroring `live.app_user` into the
     rebuilt sandbox** (`provisioning.service.js` `mirrorUsersIntoSandbox`). Per-site guards were tried and
     abandoned — dozens of columns, and every new module reintroduces the bug. `emitEvent`/`audit`/
     `soft_delete` keep their guarded sub-selects regardless (an audit must not fail over attribution), and
     `shared/events/emit.js` now exports **`resolveActorId(client, id)`** for per-module actor columns.
     **CLOSED 2026-08-02 (session 18)** — see the session-18 note at the top of this file.
   - **Onboarding gap closed.** `service_type` had **no module** (ten modules referenced it; only
     `seed-sandbox.sql` ever created one) and `POST /milestones/templates` had no caller. Built
     `operations/service_type/` (shared kit, MOD-29, immutable `key`, DELETE archives — `dossier.
     service_type_id` is a plain FK), `features/operations/service-types.tsx` **with the template editor on
     the same screen** (a service type with no active template silently produces chainless dossiers, so the
     list warns), and the **service-type field on the dossier form** — every UI-created dossier previously had
     `service_type_id = null`.
   - **`doc_prefix` stored and never read** → refs were `DOC-29-2026-0001`. `schemeFor` now takes `entityId`;
     precedence DEFAULTS → module token → entity prefix → tenant setting, with a `MODULE_TOKENS` map giving
     `SLAS-OPS-2026-0001`. **The token is load-bearing** — `doc_sequence` is keyed `(module, year, entity)`
     and restarts per module, so without it a dossier and an invoice would both be `SLAS-2026-0001`. Existing
     documents keep their numbers.
   - **`0480_party_address`** — `client_master`/`supplier_master` had **no address column at all**, so the
     bill-to side of an OHADA invoice carried only a name and a NIU. + validators + both forms.
   - **`components/country-select.tsx`** — country was free text against `char(2)` ("Cameroun" → "Ca"). OHADA
     states first; an out-of-list existing value stays selectable so an edit can't rewrite it.
   - **Milestone advance had NEVER worked.** `to` was never sent (`milestone.validator.js:7` requires it) →
     422 on every click; the first fix defaulted to `DONE`, illegal from `PENDING` (`milestone.rules.js`
     `ALLOWED`); and the page's `try/finally` with no `catch` hid both. Now sends the correct next state,
     labels itself Start/Complete, and surfaces errors.

10. **First CI run of the new pipeline — 4 of 5 jobs failed, all fixed.** Three were caught by gates that had
    never executed before.
    - `frontend (client)` + `docker-build`: **`TS6133`** — dead `React` import in the new
      `country-select.tsx` (no hooks, automatic JSX runtime, `noUnusedLocals`).
    - `build-test`: **`eqeqeq` ×2** — `!= null` in `dashboard.repo.js`; the rule is `["error","always"]` and
      the loose form bought nothing (a LEFT JOIN miss is SQL NULL, never undefined).
    - `security`: **7 pre-existing vulns (3 high)** — transitive `uuid` via **exceljs** + **node-cron**. Now
      `continue-on-error: true`. **Owed: exceljs major bump (3.4.0, breaking), then flip the step back to
      blocking.** exceljs is also the writer wanted for the still-open xlsx report export, so do it there.
    - With lint green, **`npm test` ran for the first time all session** and caught two more:
      `ai-readiness.test.js` rejected the new `service_type.ai.js` (written from memory as
      `{ module, reads:[{action_key,…}] }`; the contract is `{ entity, module_key, reads:[{key, service}] }`,
      with a correct exemplar two files away), and `numbering.test.js` asserted the old raw-number `code`.
      **The numbering TEST was updated, not the code** — its own `formatNumber` cases already used `INV`/`JE`,
      so readable tokens were always intended; the change only makes them the default instead of per-tenant
      configuration. Four missing cases added: unmapped-module fallback, entity prefix, tenant-override
      precedence, entity-lookup-throws.

**Migrations to run:** tenant **`0478_geo_place`** + **`0479_dossier_place_refs`** + **`0480_party_address`**.
**Owed:** `npm install --prefix client` (world-atlas, topojson-client). Verify by hand:
`/media` (logo + login background must still load pre-auth; a vault PDF must NOT open from a pasted URL), and
an AI follow-up question across a page reload. **Session 17 was written almost entirely without a working
sandbox VM — the CI run above, not the code review, was its first real verification.**

**Gotcha for the next session:** `grep -A` mangles forward slashes inside string literals — a path that reads
`"\ai\ask"` in grep output is `/ai/ask` in the file. Confirmed three times this session; don't "fix" one.

## Session log — 2026-07-29 (session 16: document-UI overhaul finished, master emails + doc line items, logo fix, contract signed-copy, AI vendors → platform)

**Context.** Continuation of the document-template work: the 34 templates existed and the Studio/preview/
generate/send pipeline was built (session 15 tail). This session finished the **click-through document UI**,
fixed real rendering gaps, added **line items** and **master emails**, moved **AI vendor keys to the
platform**, and cleared a run of UI bugs. Backend ESLint clean; per-file TS syntax checks clean (native
bundlers segfault in-sandbox, so no full `vite build` here).

1. **Native document detail rollout.** `DocumentPage` (`client/src/components/document-view.tsx`, route
   `/documents/:docType/:id`) renders a record in the dark app theme (not the white sheet). A drop-in
   `<DocButton docType id title/>` (`components/doc-button.tsx`) opens it. Wired across Finance (invoices,
   proformas, credit notes, receipts), Commercial (quotations), Sales (proposals), Procurement (PO, supplier
   invoice, PR), Costing (cash request, régie), HR (contracts, payslips), Fleet (work orders, trip sheets),
   WMS (GRN, cycle counts), Operations (delivery notes, transit orders + the 360° Documents tab now lists
   **invoices** with View — the "download invoices from operations" ask).

2. **Real `loadRecord` loaders** in `src/modules/documents/template/template.service.js` for the whole set.
   Gotchas resolved: **proforma** reads the `advance` table (not `invoice`); **credit note** is an `invoice`
   row `type='CREDIT_NOTE'` (no separate table); **receipts** now load `payment_allocation → invoice` so the
   doc shows *what is being paid for* (native + PDF template); **régie** page was crashing (`SELECT *` returns
   `regie_advance_id`/`state`, the client read `regie_id`/`status`) — reconciled the client type + wired View.

3. **Native renderer fixes.** Work orders (`parts`/`cost` tables), contracts (employee party + type/effective/
   ends + articles), proposals (real `proposal_narrative` sections + `proposal_line` items), cycle-count
   (resolve `inventory_item_id` → sku/description), trip sheet (odometer/route). Second-party label map per
   docType. **"From" was blank on every doc** — preview returns the entity as `{legal_name,niu,rccm}` but
   `PartyCol` read `name`/`lines`; added a `fromParty()` mapper.

4. **Logo fix (blank on every document).** `uploadLogo` stores the already-public `/media/...` URL, but
   `resolveEntity` called `storage.publicUrl()` on it again → `/media//media/...` (404). And templates only
   read the per-entity logo, while most tenants set only the **branding** logo (`appearance.logo_url`). Now:
   `resolveLogo()` inlines the bytes as a **base64 data URI** (renders in preview iframe + Puppeteer PDF +
   email — a relative `/media` URL never loads in Puppeteer), with a **branding-logo fallback** when the
   entity has none.

5. **Contract signed-copy flow.** New-contract form has an optional **email** → on create the drafted
   contract is rendered + emailed (`sendContract`). Each contract row has **Upload/Replace signed** (vaults a
   PDF via `POST /documents`, ties it via `hr_contract.pdf_vault_id`) + a "Signed on file" pill. `DocumentPage`
   Download **prefers the signed vault copy** (auth-gated blob) over regenerating. Surfaced on the Contracts
   screen **and** the employee-360 Contracts tab (shared `UploadSigned`).

6. **Send: PDF attachment + recipient resolution.** `email.service.send` takes `attachments`; the document
   `send` renders the PDF (Puppeteer) and attaches it (inline-HTML fallback). `resolveRecipient(docType, id)`
   returns the address from the party master or CRM lead. **`0475_master_email.sql`** adds `email` (citext) to
   client_master / supplier_master / employee; validators + the client/supplier/employee forms capture it;
   the Send prompt pre-fills the resolved recipient.

7. **Document line items — `0476_document_lines.sql`.** New child tables purchase_request_line /
   delivery_note_line / transit_order_line / grn_line (FK + cascade). Backend: repo insert/list + service
   create accepts `lines` (GRN overrides the generic `makeService.create` to split lines off the header);
   validators; template loaders read them; create forms got inline line editors. Those four docs no longer
   render header-only.

8. **DSF** — bespoke `dsfBuild` (SYSCOHADA structured: identification / income statement / balance sheet / IS
   at 33%) replaced the generic report renderer; sample enriched. Honest: still a structured summary, not the
   pixel-exact DGI liasse (needs the official master PDF).

9. **AI vendor keys → platform (shared, deploy-wide).** New **`platform/0060_ai_vendor.sql`** (shared
   `ai_vendor_credential` on the platform DB, seeds the 4 vendors). New `services/platform/ai-vendor.service.js`
   (list/set/getConfig/test via `platformDb` + `encryption`) + platform routes `GET/PUT/POST
   /api/platform/ai-vendors[/:vendor[/test]]`. **Runtime swap:** `llm.service`, `embeddings.service`,
   `ai-transcribe`, `ai-vision` now read the shared keys via `platformVendors.getConfig()` (env fallback kept)
   instead of the per-tenant governance store. **Tenant side removed:** Vendors tab dropped from `AiControlHub`;
   `/ai/governance/vendors` routes removed. **Console:** managed under **Integrations → AI providers**
   (`AiVendorsSection`); `/ai-vendors` redirects there; nav slimmed to 5 primary + a **More** dropdown.

10. **AI Control menu gating.** `useVisibleNav()` (reuses `useAiEnabled`) hides "AI Control" from the sidebar +
    ⌘K palette when the tenant has AI off, and `AiControlHub` redirects a direct URL home. Verified
    `ai_enabled` = tenant feature flag `ai.assistant.backend` (same source as the backend gate).

11. **UI fixes.** Clock-in FAB moved **inside** the hover-expanded floating cluster (was briefly removed, then
    corrected per feedback). **Favicon** now applied from branding in `paint()` (`branding-context.tsx`) — it
    was stored but never written to `<link rel=icon>`. Vendor-card status control constrained (global input
    width was stretching the checkbox).

12. **Docs.** New **`doc/PLATFORM_CONSOLE_DEPLOY.md`** (rollout runbook for `admin.praxisls.com`: verify
    host-gating, run migrations, set shared AI keys, verify runtime, rollback). `doc/DOC_UI_OVERHAUL_STEP1.md`
    kept current.

13. **Numbering display + line-item integrity.** (a) Issued/posted docs had real numbers but the lists showed
    UUIDs because they read `r.ref`, which the list repos never populated (DB column is `doc_number`/`ot_number`).
    Aliased the number `AS ref` in the PR/PO/supplier-invoice/transit/delivery list queries. Draft docs are
    still numberless by design (numbered at Submit/Issue/Post). (b) Line items were **free-text** → data could
    drift; now they reference a real catalogue row via a shared `catalogue-select.tsx`
    (`DictionaryItemSelect`/`InventoryItemSelect`): PO + PR → financial dictionary, GRN + delivery note +
    transit order → inventory. **`0477_line_item_refs.sql`** adds the FK columns (`dictionary_item_id` /
    `inventory_item_id`); the row's `label` stays as a display snapshot (like `po_item`). NB the selects are
    empty until the dictionary/inventory masters have rows.

**Migrations to run:** platform **`0060_ai_vendor`** + tenant **`0475_master_email`** + **`0476_document_lines`**
+ **`0477_line_item_refs`** (`deploy.sh`'s migrate service runs both sets). **Owed:** full `tsc` / `vite build`
/ `jest` on a real machine; set the shared AI keys in the console; verify a live AI chat/embedding on a tenant
(credential path changed); ensure the financial-dictionary + inventory masters are seeded so the line selects
have options.
## First thing to do in a new session

Sessions 1–15 each left a "pick up here" list; every one of those items has since been done or
superseded, so they now live in `doc/SESSION_HISTORY.md` rather than at the top of this file.
What is actually outstanding:

1. **Owed from session 19b — do these first.**
   - `npm run build --prefix client` and `npm test` on Windows. ~25 FE files changed after the last
     green build, and `tsc` does not complete on the sandbox mount, so none of them are typechecked.
   - Migrations: tenant **`0488`–`0492`**, seeds **`9022`** + **`9130`**.
   - A **non-CEO** click-through of the approval chain: `doc/APPROVAL_VERIFICATION.md`. This is the
     single test that would have caught the four permission bugs of 19b before they hit a screen.
   - Sanity-check the permission matrix after rebuilding: it was silently overwriting grants it
     hadn't loaded, so grants set on that screen before today may have been lost.
   - Nothing is owed from sessions 16–18. Migrations `0475`–`0482` are applied and lint/test/build
     were green (user-run on Windows). Do not re-raise the validation items in the older logs.
2. **Before another tenant is provisioned** — nothing, as of 2026-08-02. The sandbox-user gap that
   made a fresh tenant's first TEST write fail is closed and runs on every deploy. Worth one
   sanity check after the next provision: sign in, flip to TEST, create something.
3. **Before a real external party uses the portal** — tenant SMTP configured, `portal.*` feature
   flags on, and a scoping click-through (a client sees their own dossiers and nobody else's).
4. **Pick from** `WORK_TO_BE_DONE.md` → "Repo audit — 2026-08-02" for the open list with file+line
   evidence, and `doc/ORGANOGRAMME_AUDIT_2026-08-02.md` for the approval/organigramme surface (its
   status banner says what is done and what is not).

   Session 19 closed `depends_on` enforcement, built user↔capability assignment, mounted
   `requireCapability`, added the self-grant block and gave AssetsPage its write UI. Session 19b did
   the approval engine, the organigramme, departments-as-scopes and the first `scopeColumn` adopters.

   **Tractable next:**
   - **B1 — a reporting line on `employee`.** This is the one product decision left in the
     organigramme work: `LINE_MANAGER` is seeded as "approves for own team" and nothing can resolve a
     team. W13 (delegation, escalation, deadlines) depends on it — "the only approver is on leave"
     currently has no answer in the model.
   - **C7** — `portal.*` gates the staff preview but not the external routes, so turning a portal off
     doesn't stop clients reading. The flag is not the kill switch an operator would reach for.
   - The remaining `scopeColumn` adopters (only `vacancy` and `purchase_request` are wired), or the
     xlsx/csv export wiring.

To preview: `npm run dev` (backend, repo root) + `cd client && npm run dev`. Set `VITE_TENANT_HOST`
to a provisioned tenant (e.g. `smartls.praxisls.com`).

## Known remaining work / gaps

- **AI chatbot — COMING, not cancelled (2026-07-20).** Session 10 deleted the *mock's* Praxis chat from the
  Control Tower (canned replies on a timer, greeting a hardcoded "Amara"). The real assistant already
  exists: `components/praxis-copilot.tsx`, mounted in `app-shell.tsx:614`, self-gating on `ai_enabled`,
  and `/ai/ask` + `/ai/governance` are built. Three things when the work lands: (a) turn on
  `ai.assistant.backend` — the last route-gated feature still `off` by design — and note **users must
  re-login**, since the FE gate reads `user.ai_enabled` off the session payload issued at sign-in;
  (b) decide whether the Control Tower floatbar gets its "Chat with Praxis AI" entry point back, opening
  the **real** copilot via a `postMessage` type plus a trigger on `PraxisCopilot`; (c) `ai.assistant` and
  `ai.vectorization` are separate keys, also off.
- **Control Tower — still mock (2026-07-20):** the **map** (fixed geography + three hardcoded lanes; now
  badged *Sample view · not live*, wiring deferred by decision) and the **Recent activity** feed (deleted
  rather than left fictional — needs an activity endpoint that doesn't exist). Everything else on the home
  view is live or routes into the real app; see session-10 log §5.
- **`depends_on` IS enforced at projection time (session 19).** `projectFeatures()` now runs
  `enforceDependencies()` — a child feature is forced off unless every key in its `depends_on` is on
  (fixpoint, so chains cascade; unknown dep = unmet). `scripts/tenant/feature-report.js` still reports the
  condition as a cross-check.
- **Fleet/WMS may hide more never-executed SQL.** Those 19 modules ran for the first time on 2026-07-20.
  The join audit (session-10 log §3) is clean, but it didn't cover every column each repo selects from its
  own primary table.

- **Quick PIN — DONE (2026-07-18).** FE done (login modal + `/security/my-security`, backend
  `/auth/pin/*`); the `user_device` migration (columns: `device_id, user_id, label, pin_hash,
  status, failed_pin, last_used_at, created_at`) has landed in the **identity/live schema** per
  the pin-auth-to-identity decision. QuickPIN is live; no FE or BE work remaining.
- **⌘K command palette built** (`command-palette.tsx`). **Mobile bottom nav — DONE (session 2)**
  (`app-shell.tsx` `BottomNav`).
- **Landing hero assets are tenant-authored** via Appearance (image + copy + chips). Blank
  fields fall back to generic copy; the "Pixie Hub" content in the reference video is
  sample data, not shipped defaults.
- **Finance write forms — DONE (2026-07-15).** Tax-declaration **filing** and **credit notes**
  are now wired to the new BE modules. Tax Center gained a **Declarations / filing** tab
  (file→approve→submit); new **Credit notes** screen at `/finance/credit-notes`
  (create→edit→post). Helpers in `lib/finance-api.ts`; forms in `features/finance/pages.tsx`;
  routed in `app.tsx` + nav (`app-shell.tsx`) + `screen-registry.json` (`fin_credit_notes`).
- Control Tower dashboard is **LIVE** — `features/dashboard.tsx` reads `/dashboard/kpis` +
  `/dashboard/control-tower` (MOD-00A). **Session 7:** reverted from plain React tiles to the **Lovable
  mock in an `<iframe srcDoc>`** with that live data injected; `features/dashboard-mock/*` is **restored
  and in use** (no longer safe to delete).
- Platform console UI and per-tenant PWA manifest still not built (Phase 0 items).
- **Cleanup — DONE (session 2):** the stray `client/src/_wtest.txt` was removed.
- **LIVE/TEST toggle logs the user out — architectural, not a UI bug (diagnosed 2026-07-13).**
  `X-Praxis-Env` is a *database-schema switch*: `middleware/tenant-context.js` binds every DB
  call in the request to the live or sandbox schema (`registry.service.js` → `SET search_path`).
  Crucially the **auth path is bound to that same schema**: `middleware/auth.js` loads the user
  via `req.tenantDb(getAuthUser)` and `app_user.service.refresh()` validates the session via
  `repo.getActiveSession(client, sid)` on `user_session` — both in the env-selected schema.
  Accounts are created in **live** by default (`scripts/tenant/create-admin.js --env=live`), so
  the sandbox schema has **no user and no session**. Flipping to Test therefore makes the very
  next request `401` (`USER_INACTIVE`), the client auto-refresh also runs under sandbox and
  `401`s (`SESSION_REVOKED`), and the user is bounced to `/login`. The `window.location.reload()`
  in `toggleEnv()` (app-shell) isn't the cause — it just triggers it immediately.
  **Fix — IMPLEMENTED (2026-07-15): identity pinned to the live schema.** `middleware/tenant-
  context.js` now exposes **`req.identityDb`** (always the live schema); `req.tenantDb` still
  honours `req.env` for business data. Pinned to `req.identityDb`: `middleware/auth.js`
  (`getAuthUser`), `middleware/rbac.js` (grants / scope / capabilities), the whole
  `security/app_user` controller (login, refresh, logout, verifyTotp, setup/enable/disable TOTP,
  pin register/login/list/revoke, and user CRUD), `security/session`, and the RBAC-admin writes
  (`permission` incl. `upsertGrant`, `iam_role`, `capability`, `scope`, `field_visibility`) via a
  new `makeController(service, label, { identity: true })` option in `shared/crud/resource.js`.
  The auth *services* were untouched — they already take a `client`; only the controller/middleware
  chooses which schema's client to pass (`environment` on the session row stays as metadata).
  Alternative (seed users/sessions into sandbox) was rejected as messier. **FE polish — DONE
  (2026-07-15, part 3):** soft toggle without reload (`key={env}` remount), segmented Live|Test
  control, and the yellow TEST-MODE banner — all in `app-shell.tsx`. See that session log.
  **Residual coherence items:** (a) **field-mask — DONE (2026-07-15).** `shared/rbac/field-mask.js`
  gained `maskForUserVia(identityDb, user, data)`, which resolves masked field_keys from the
  identity schema (`req.identityDb`) while the data itself is still read on the env client;
  `employees` + `operations_file` controllers switched to it, so masking stays enforced under TEST.
  (b) **audit_ledger — DONE (2026-07-15).** Split by data class: **access reviews**
  (`listReviews`/`createReview`/`getReview`/`completeReview`/`decideEntry` — `snapshotEntries`
  reads `app_user`/`user_role`) and **security-events** (`listSecurityEvents`, reads `event_log`
  which auth+RBAC now write via the live client) pinned to `req.identityDb`; **soft-delete restore**
  (`listSoftDeletes`/`requestRestore`/`restore`) + base CRUD stay `req.tenantDb` (per-env business
  records). (c) **portal — no change needed (2026-07-15).** The `portal` module manages
  `portal_access` (which external client/investor/auditor parties may view which dossier) — per-env
  **business** data — and issues **no `app_user` sessions**, so it doesn't share the identity model.
- **Search bar** now opens the ⌘K palette (was a stopgap that opened the sidebar) — resolved.
- **Login screen displays saved login config — DONE (session 2).** `landing-page.tsx` now reads
  `fetchLogin()` (backgroundUrl / headline / subtext / layout / showLogo / accentOverride) with
  hero → generic fallbacks. `centered`/`split` layout wired in `index.css`.
- **Live theme apply — DONE (session 2).** `theme.ts` `applyBrand()` + `branding-context.paint()`
  now apply the full token set (accent/secondary/info/success/warn/danger/fonts/radius), with
  hex→triplet conversion for `--ok`/`--warn`/`--bad`. `resetBrand()` reverts them all.
- **Settings tiles — nearly all built now.** Currencies, tax rates, numbering, bank accounts, payment
  gateways, pipeline stages (read-only), scheduled reports, API keys/secrets (sessions 4–5) + document
  templates, custom fields, email signatures, policies (2026-07-18, `store-pages.tsx`). Only **factory
  languages** and **help center** remain `Planned` (no BE endpoint).
- **Live/sandbox (LIVE/TEST) toggle** — detailed gap above; the shared-identity yes/no design
  question has been **sent to the BE dev, awaiting an answer**. `user_device` sits in the same
  schema model, so its fix rides on the same decision.

## Conventions

Modules = 7 files (`repo`/`service`/`controller`/`routes`/`validator`/`events`/`ai.js`);
**SQL only in `.repo.js`**, never in `.service.js`; RBAC-gated routers
(`requirePermission(M, action)`, actions view/create/edit/delete/approve — it's **"edit"
not "update"**); non-README MD files live in `doc/`. Ask before large or destructive
changes.

## Sandbox gotcha

The bash workspace mounts the Windows folder over a network FS whose page cache goes
**stale** for files written via the file tools — it can serve old/**truncated**/NUL-padded
copies, so in-sandbox `node`/`grep`/`jest` on freshly edited files give false failures.
**Confirmed again 2026-07-13:** the file tools (Write/Edit) truncated/NUL-padded several
`.tsx` files on this mount; rewriting them via a bash heredoc (`cat > file <<'EOF'`) writes
reliably (`rm`/unlink is blocked, but `>` truncates fine). Restoring a clean base from git
(`git show HEAD:path > path`) then re-applying is also reliable. Note: `client/package-lock.json`
is Windows-generated, so a Linux `vite build` fails on the missing `@rollup/rollup-linux-x64-gnu`
native binary — that's environmental; a normal `npm install` on Windows fixes it and `tsc`
is the trustworthy in-sandbox check. The real files are correct (Vite/tsc/PowerShell see them
fine). Fix: start a fresh session (remounts clean), or just validate on Windows.
**2026-07-14:** the mount degraded further and the sandbox eventually **died outright**
(`Failed to create bridge sockets`) — no in-sandbox `tsc`/bash for the tail of the session. The
file tools kept writing correct Windows files throughout. **Start a fresh session before the
next chunk so `tsc` works again**, and run `npm run build --prefix client` on Windows to confirm
this session's FE changes typecheck.
**2026-07-14 (session 2):** recurred — the page cache wedged on `app-shell.tsx` mid-session
(served a truncated 565-line copy while the file-tool view showed the correct 609-line file).
`touch` didn't refresh it. Do **not** `cat`/`sed` the cached copy back onto the mount — that
would write the truncated version to the real file; the reliable recovery is a fresh session or
a full bash-heredoc rewrite with known-good content. The earlier theme/landing edits this session
did pass `tsc -b --force` before the cache wedged.
