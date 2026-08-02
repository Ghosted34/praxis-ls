# Praxis LS — Session History (sessions 1–15)

Archive split out of `doc/SESSION_HANDOFF.md` on 2026-08-02, when that file's header had grown to a
single 4,000-word paragraph and the whole document to 2,500 lines. **Nothing here was edited** — the
sections are verbatim, oldest material at the bottom, exactly as they were written at the time.

Read this when you need the reasoning behind an older decision. For current state start at
`doc/SESSION_HANDOFF.md`; for the full append-only record of every change see `doc/WORK_DONE.md`.

⚠️ **Statuses in this file are historical and several have rotted.** Items marked open in sessions
1–15 were audited against source on 2026-08-01 and again on 2026-08-02 — see the audit banners in
`doc/WORK_TO_BE_DONE.md` before acting on anything below.

---

## Post-merge reconciliation — 2026-07-18 (after PR #11 merged into main)

The other dev merged main on his side; both streams landed large commits the same day. **Rule applied:
his side takes precedence on BE and on any overlapping screen.** Merged tree verified **`tsc` clean**.

**Collisions found + resolved:**
1. **Migration number clash.** Both streams used 0450/0451. His keep `0450_comms_channel_flags.sql` +
   `0451_email_inbound.sql`; mine renumbered via `git mv` → **`0452_campaign_templates.sql`** and
   **`0453_session_refresh_jti.sql`**. Confirmed **no environment had applied either pair**, so no
   reconciliation of applied-migration rows was needed. All doc references updated.
2. **`/comms` registered twice.** His `CommsHub` (+ `/comms/:section`) won; my `SmartCommsPage` was
   unreachable. **Deleted `features/comms/pages.tsx`** and its route/import — his suite is richer and
   BE-backed (mail module, channel flags, `channels` on the auth payload).
3. **`/godmode` registered twice.** His `GodModePage` then a stale `<Planned/>`; **removed the dead route.**
4. **Two workspace pages.** Mine was wired, his was orphaned. Per the precedence rule, **kept his
   `features/workspace/workspace-page.tsx`** (same `WorkspacePage` export → import swap) and **deleted
   `features/workspace/pages.tsx`.**
5. **`app_user.service.js` — no conflict.** His `resolveChannels` / `channels` payload and my rotation +
   reuse-detection both survived and coexist.

**Verified intact after merge:** all my BE (dashboard KPI aggregates, refresh rotation + reuse-detection,
campaign templates/senders/send), the settings store tiles, the vault trio, the Control Tower KPI wiring,
the campaign FE, the `SearchSelect` conversions (incl. `commercial/pages.tsx`, which he also edited), and
both new unit tests.

**`features/finance/pages.tsx` — co-existence, not a conflict (checked).** He edited imports, `JournalsPage`,
`AdvancePaymentForm`, `ProformasPage`, `InvoiceDraftForm`, `InvoiceSubmitForm`, `InvoicesPage`,
`ReceivablesPage`, `ChartOfAccountsPage` and `ReportTabs`; this stream's only changes are the
`SearchSelect` conversions inside `CreditNoteCreateForm` / `CreditNoteEditForm` (~L1800+, entity / client /
reversed-invoice, the last using the optional `filter` prop to stay scoped to FINAL invoices). **Disjoint
hunks — nothing to revert or merge; the file is already best-of-both.** These four are 100% his with no
trace from this stream: `master/pages.tsx`, `masterdata/pages.tsx`, `governance/pages.tsx`,
`lib/finance-api.ts`.

**Note for whoever commits:** a stale `.git/index.lock` was created by a blocked `git rm` and has been
removed — if git complains about a lock again, delete `.git/index.lock`.

### Post-merge continuation (same day) — idiom convergence + last screens

**Idiom convergence.** The merge left three apparently-competing pairs; on inspection only one was a
real duplicate:
- **AI — no work needed.** His `ScreenAi` *imports* this stream's `AiActions`, and `PraxisCopilot`
  imports `useAiEnabled` and returns null when off. His layer already composes on the global gate.
- **Lists — both kept, they're different abstractions.** `ResourceList` self-fetches from an `endpoint`
  prop (quick read-only screens); `DataList`/`PageHeader` is presentational with 4 states + custom cells
  (page owns the data). **`DataList` is the default for new wired screens.** The real duplication was
  `cell()` existing twice *and diverging* on boolean casing — now one implementation in **`lib/format.ts`**,
  re-exported from both modules so no import path changed (his `"Yes"/"No"` casing won).
- **Tabs — both kept.** `TabbedHub` is a route-driven hub shell (`/base/:section`); `Segmented` is
  in-page state. The genuine duplicate was the Master data hub hand-rolling an identical tab bar → it now
  uses `TabbedHub`. ⚠️ `TabbedHub` publishes its bar via **context**, expecting each tab page to render
  `<HubTabs/>` (his costing/ai-control pages do). Master data's pages don't, so a naive swap would have
  made those tabs vanish — hence the new optional **`inlineTabs`** prop (default off; his four hubs
  untouched) which renders the bar in the shell.

**Screens.** **Module catalogue** built (`/settings/catalogue`, `features/settings/catalogue-page.tsx`) —
read-only MOD-xx reference on `GET /catalogue/modules`. **Business setup retired**: it duplicated the
Corporate entities editor, so `/settings/business-setup` now redirects to `/master/corporate-entities`
and the hub card was repointed.

**Corporate entity gaps closed (BE + FE).** `address` and `bank_block` were writable on the API but had
no UI anywhere; `logo_light_ref`/`logo_dark_ref` were columns the validator silently dropped. Added both
logo fields to the create/update validator plus a new **`POST /entities/:id/logo`** (`{data_url, variant}`,
512 KB cap, allowed image types, stores under `tenant_<slug>/entity/<id>/`, audited) — **gated MOD-01
edit on purpose**, since reusing the MOD-70-gated `/branding/logo` would force settings-admin rights just
to set an entity letterhead. FE: the Corporate entities editor now edits Address, a Bank details block
(bank/branch/account/IBAN/SWIFT → invoice payment block) and the letterhead logo.

**Control Tower.** The 4th KPI card (receivables overdue) is now live too — derived FE-side from the
existing `receivables_ageing` report producer (sum of the past-due buckets), so **no new BE**. Hides when
`reporting` is off rather than showing a stale mock. All four cards are real.

**Bundle.** `vite.config.ts` gained `manualChunks` (vendor-react / vendor-charts / vendor / dashboard-mock
/ `feature-*`) for the >500 kB warning. ⚠️ **Unverified in-sandbox** — `vite build` can't run here (the
Windows-generated lockfile means the Linux rollup binary is missing). If the Windows build errors, just
revert that file; nothing depends on it. Note it improves caching/parallel download but **not first-load
bytes** — routes are still eagerly imported; route-level `React.lazy` is the deferred follow-up.

**Remaining FE:** only **Factory languages** and **Help center**, both genuinely BE-blocked (no endpoint).
## Session log — 2026-07-27 (session 15: Lovable kit fidelity, AI gate + clickable actions, workflow blocks, SOPs/Talent build-out, fixes)

A large FE-fidelity + depth batch driven screen-by-screen against the user's local tenant. **In-sandbox
`tsc -b` clean (client), Tailwind/PostCSS compile clean, root + backend ESLint clean. NOT runnable in-sandbox:
client `vite build` (Windows-lockfile → Linux rollup native "Bus error"), `jest` (needs Postgres), client/
platform-console ESLint (their new flat-config deps aren't installed here). Windows validators authoritative.**

**1. Lovable kit-fidelity restyle — finished (was "audit complete, kit restyle NOT started" in
`LOVABLE_FIDELITY_PLAN.md`).** All restyle lives in the shared kit so every screen re-skins at once, tokens
only (colours track `--primary` via `color-mix` so tenant re-tint keeps working):
   - **`index.css`**: `--ease`/`--dur` motion tokens, `fadeUp` + `modalRise` keyframes, a global
     `prefers-reduced-motion` kill-switch, `.chip`/`.chip.on`/`.chip .ct` + `.sec` classes, and
     `.btn-primary`/`.btn-surface` recipes. `.font-display` already forced weight 400; **stripped the
     now-redundant `font-semibold` off every serif heading** (~9 files: operations, finance, security, vault,
     comms, help, workspace, permission-matrix).
   - **`components/ui/button.tsx`** — `default` = gradient + orange glow + `-1px` hover lift; `outline` =
     surface + lift + orange hover border (radius 11, 13px/600).
   - **`components/ui/table.tsx` + `data-list.tsx`** — tablecard wrapper (`rounded-[var(--radius)]`, overflow-x
     scroll), micro uppercase header on `--secondary`, faint row borders, **orange row hover**, `fadeUp`.
     Header no longer `font-semibold`. **Mobile card fallback** added to `DataList`: table on `sm+`, a
     label/value card per row on phones (unlabelled action columns drop to a full-width footer).
   - **`components/ui/kpi-tile.tsx`** — 38px orange-tinted icon square + serif-30 value + optional `delta` +
     `-3px` hover lift + `fadeUp`.
   - **`components/ui/modal.tsx` + `input.tsx`** — modal radius 22 + `shadow-l` + `modalRise`; inputs/select
     surface bg, radius 10, 13px, **border-tint focus** (no ring). Dark-mode option-colour fix kept.
   - **Chips/segmented** — `features/sales/ui.tsx` `Chips`→`.chip` and `Segmented`→reference seg recipe; **every
     hand-rolled filter/nav pill row converted** (operations, finance hub + "more modules", chart-of-accounts,
     comms/mail, vault hub, security hub, security role-toggle).

**2. Per-screen AI gate restored across HR/Fleet/WMS (was a systematic gap).** `screen-specs.ts` had **zero**
`ai` entries for `hr/`, `fleet/`, `wms/` while every other area had them, and none of the 21 rebuilt screens
rendered `<ScreenAi/>`. Added `ai` specs (read/write actions) for all 21 paths and dropped
`<ScreenAi path="area/screen" />` into each screen (scripted, CRLF-safe). **AI-action cards are now clickable**
(`components/ai-actions.tsx`): a card dispatches `praxis:open-copilot` with `detail.prompt = action.describe`;
`components/praxis-copilot.tsx` opens and auto-sends it (via a `sendRef` so the once-registered listener isn't
stale). Writes still return AWAITING_CONFIRM → Confirm button, so the "human confirm on writes" promise holds.
Works on every screen because `AiActions` is shared.

**3. Shared workflow blocks — extracted + adopted (the depth plan's "build once, reuse").** New
**`components/ui/workflow.tsx`**: `StepBar` (linear lifecycle stepper), `StatusActionBar` (status Pill +
transition buttons), `TransitionButtons` (the per-row / detail action group; each item carries its own
`loading`), `LineTable` (bordered line-item grid w/ loading/empty). Adopted in **9 screens**: work-orders +
outbound (StepBar+StatusActionBar+LineTable), cycle-count (LineTable), contracts + incidents + dispatch +
inbound + equipment (TransitionButtons, some routing modal-open vs status set), vehicle 360 (TransitionButtons
for the Active⇄Inactive→Disposed ladder). StepBar is only used where the lifecycle is strictly linear
(work-orders, outbound); toggle/branching lifecycles keep just the action bar.

**4. SOPs & Talent pool built out for real (was "light reference lists", backend-blocked).** The tables
existed (`0360_hr_breadth.sql`: `succession_plan`, `onboarding_checklist`, `onboarding_item`) but had **no
routes** — so two NEW auto-discovered modules were added:
   - **`src/modules/hr/succession/`** (MOD-19, basePath `/succession`, `feature:null`) — CRUD via the shared
     resource kit; `repo.list` LEFT-JOINs `employee` for incumbent/successor names. Mirrors `talent_pool`.
   - **`src/modules/hr/onboarding/`** (MOD-16, basePath `/onboarding`) — custom parent/child: list checklists
     (w/ employee name + done/total counts), create (employee + optional initial items), add item, toggle item
     (sets `done_at`), complete. `audit`-only (no `emitEvent`; `event_log.event_type_key` has no FK so it'd be
     safe either way).
   - **FE**: Talent tab → **"Talent & succession"** (KPIs + a succession board of role→incumbent/successor
     cards with a readiness pill + New-plan form, above the candidate bench). SOPs tab → **"SOPs & onboarding"**
     with a Procedures/Onboarding chip toggle; Onboarding = checklist cards w/ progress bars + a detail modal
     (tick items, add steps, mark complete). No migration needed (tables pre-existed) — **API restart mounts
     the two modules**; tenant DBs must have run 0360 (normal provisioning has).

**5. Fixes.**
   - **Platform-console `citext = uuid` 500 (empty Features/Roles).** `plans.service.planIdOf` compared one
     param against a `uuid` column AND a `citext` column (`WHERE plan_id = $1 OR code = $1`); a uuid arg made PG
     type `$1` as uuid, so `code = $1` errored (`42883`), 500'd the endpoint, and the console rendered the error
     as an **empty table** (it was never a missing seed — the catalogue seed exists + is complete). Fixed by
     comparing on text (`plan_id::text = $1 OR code = $1`); **same latent bug fixed in `roles.service.roleIdOf`**.
   - **Vacancy → employee role carry-over.** `vacancy.service.setApplicantStatus` (on the transition into
     `HIRED`) provisioned the employee with only `full_name` — so the profile showed "—". Now copies the
     vacancy's `title` → `employee.job_title` and `department` → `employee.department`. (Email/phone/CV still
     don't carry — no columns; would need a migration.)
   - **Employee 360 Edit.** New Edit button + prefilled modal (name / entity / department / job title /
     employment type) → `PATCH /employees/:id` (endpoint already existed; added `updateEmployee` to `hr-api.ts`)
     — the way to fix pre-fix hires like the "Jane Doe / role —" case.
   - **Mobile overflow.** Wide tables scroll in-card + the new card fallback; the **vacancy kanban** clipped its
     last column because it sat in a grid track (`min-width:auto` grew to content) — fixed with `min-w-0` so the
     board's `overflow-x-auto` engages. (Sales kanban is in a block section, already fine.)
   - **AI runtime gate disconnected from the console (AI "unavailable: feature disabled" despite the toggle
     on).** Session-14 wired `feature_state` → the login/UI gate, but the orchestrator's per-call gate
     (`governance.canUseFeature`) still read a **never-seeded `ai_feature_flag['assistant']` row** (key mismatch
     vs the console's `ai.assistant.backend`) and treated a missing row as OFF — so the panel showed but every
     ask 403'd. Fixed: `canUseFeature` now resolves tenant enablement via **`isFeatureEnabled('ai.assistant.
     backend')`** (the same feature_state ceiling + default-ON preference the UI uses), and a **missing per-user
     access grant is now permissive** (opt-out: only an explicit *revoked* grant blocks; budget hard-cap still
     blocks) — the copilot is already RBAC-bounded, and grants were never provisioned so requiring one made the
     console toggle inert. Pure `canUse` rules untouched (its tests stay green); `tests/unit/ai-gate.test.js`
     updated to the console-driven model. **Restart the API** to apply.
   - **AI retrieval crashed instead of degrading when embeddings fail.** On a bad/absent embeddings key the
     vendor service logs "skipping vectors" and returns `[]`, but `retrieval.service.retrieve` then did
     `toVec(embedOne(...))` → `undefined.join` → a 500. Guarded it: no embedding → return no vector hits, so the
     assistant still answers (just without KB grounding).
   - **AI vendor keys had no way in.** "AI Control → Vendors" lists rows meant to be *seeded on bootstrap* +
     edited to paste a key, but **no seed ever created them** (`0400_ai.sql` makes the table, inserts nothing) —
     empty list, no Add button = dead end. Added an **"Add vendor" button** + form (`features/ai-control/
     pages.tsx`) using the runtime's real vendor ids (**`embeddings`** ← the one that fixes the pgvector 401,
     `deepseek` chat, `gemini` vision, `groq` voice; `PUT /vendors/:vendor` upserts), AND a seed
     **`migrations/tenant/0470_seed_ai_vendors.sql`** (endpoint+model only, no key, `ON CONFLICT DO NOTHING`) so
     the four rows pre-appear. A DB vendor row overrides the `.env` key (which ships `__rotate_me__`
     placeholders → the 401). Run `db:migrate:tenants` to seed existing tenants.
   - **Dead code.** Deleted the unused `components/crud-resource.tsx`.
   - **ESLint gates.** `client/` and `platform-console/` shipped **no** flat config, so `eslint .` self-ignored
     under ESLint 9 (client lint gate was effectively off). Added `eslint.config.js` (typescript-eslint +
     react-hooks + react-refresh) + devDeps + fixed the `lint` script (dropped the ineffective `--ext`) to both.
     **Needs `npm install` in each before the lint runs.**

**6. Owed / notes.** Windows: `npm install && npm run lint && npm run build` in `client/` and `npm install &&
npm run lint` in `platform-console/`; `npm test` at root. **`db:migrate:tenants`** (applies `0466_employee_
earning` — the Appraisals 500 — and any other pending tenant migrations). **Restart the API** to mount
`hr/succession` + `hr/onboarding`. Flip **`ai.assistant.backend` on per tenant** in the console so the AI panel
shows. Set **`PLATFORM_CONSOLE_HOST`** for the prod console. StepBar has no more clean linear-lifecycle homes
without building new detail modals. Optional follow-ups: carry applicant email/phone onto the employee (needs
columns) and a stored employee↔applicant/vacancy link for traceability (today it's audit-trail only).

## Session log — 2026-07-24 (session 14: feature-toggle fix, platform RBAC, Plans CRUD, users, console refresh, lifecycle, human-readable + UI)

A large, user-driven batch (rapid-fire, verified screen-by-screen against the user's local
`:5173` tenant / `:5174` console). **All BE `node --check` + eslint clean; full client + platform-console
`tsc -b` clean; Windows lint/test/build user-confirmed green.**

**1. Feature toggle → tenant screen (the headline bug).** There were two disconnected feature systems:
the platform-projected **`feature_state`** (tenant DB, written by the console via
`tenant_feature_override` → `projectFeatures`, read by the route gate `requireFeature`) and the tenant
**`ai_feature_flag`** (AI + comms flags). The login payload's `ai_enabled`/`channels` came from
`governance.isFeatureEnabled`, which read **`ai_feature_flag`** — a table the console never touches — and
**no `ai.assistant.backend` row is ever seeded there**, so AI was unconditionally off regardless of the
console. Fix (`ai/governance/governance.service.js` + `.repo.js` new `featureStateOn`): `isFeatureEnabled`
now returns **entitlement (`feature_state`='on') AND preference (`ai_feature_flag.is_enabled`, default ON
when entitled and no row)** — "console gates, tenant refines". Added **`GET /api/tenant/auth/me`**
(`app_user.service.me` + controller + route) recomputing `ai_enabled`/`channels`; the client boot
(`auth-context.tsx`) re-fetches it after the refresh so a toggle reflects on reload (no full re-login).
New seed **`9112_add_channel_features.sql`** brings `whatsapp`/`instagram` into the platform
`feature_catalogue` (+ Full/Enterprise `plan_feature`) so the console can gate them too. **User-verified:
AI UI now appears on the tenant after enabling in the console.**

**2. Platform-tier RBAC — permission matrix + custom roles (pivot from a fixed-role set).** New migration
**`0031_platform_rbac.sql`**: `platform.platform_role` + `platform.platform_role_permission` (role×capability
matrix), drops the old 3-value CHECK on `platform_user.role`, seeds the 3 built-ins (Root Admin / Support /
Billing) with their capability sets. Middleware (`middleware/platform-auth.js`): a **`CAP_CATALOGUE`** (13
caps: tenants.read/write, features.write, plans.read/write, users.read/write, roles.read/write,
support.read/write, audit.read, catalogue.read), `platformAuth` now loads the role's caps into
`req.platformCaps`, and **`requireCap(cap)`** gates each route — **Root Admin bypasses checks** (like the
tenant CEO, so it can't lock itself out). `platform.routes.js` fully re-gated per-route (was a blanket
`requirePlatformRole("PLATFORM_ROOT_ADMIN")`). Services: **`roles.service.js`** (list matrix / create /
setPermissions / delete — guards system roles + in-use), **`users.service.js`** (CRUD, Argon2id, guards:
no self-delete, always ≥1 active Root Admin, role validated against the roles table), **`plans.service.js`**
(below). Login/refresh now return the user's **`capabilities`** so the console hides controls a role can't
use. Console FE: **Roles** page (live roles×capabilities matrix + add/delete custom role), **Users** page
(create/edit/password/activate/delete, role dropdown from the matrix), nav gated via a new `can(cap)` helper
(caps come from the login payload). **⚠️ 0031 must be applied before the console Roles/Users pages work.**

**3. Plans CRUD + per-plan feature matrix.** `plans.service.js` + routes under `/plans`: create, edit
(name/prices), **feature matrix editor** (toggle a plan's included features → re-projects `feature_state`
for every tenant on that plan), and **delete-with-reassign** (move tenants to a replacement plan, re-project,
then delete; `plan_feature` cascades). Console `Plans` page rebuilt with these + a features modal. Plan
audit rows land in `platform_audit` (tenant_id NULL).

**4. Platform-console token refresh (fixes "logged out / page reloads on refresh").** The console had **no
refresh** — its api-client cleared the session and bounced to login on any 401, so the admin was kicked out
at the 15-min access TTL. `services/platform/auth.service.js`: login now issues a **stateless refresh token**
(`typ:"platform_refresh"`, `JWT_REFRESH_SECRET`) and **`refresh()`** mints a fresh pair after re-checking
`is_active` (the revocation lever; no platform session table, so no rotation-reuse detection yet). New
**`POST /api/platform/auth/refresh`**. Console `api.ts`: stores the refresh token, **silent refresh-on-401 +
retry** (de-duped) before clearing the session; `Login.tsx` persists it.

**5. Tenant setup / lifecycle completion from the console.** **Plan change** — `PATCH /tenants/:slug/plan`
(re-projects, keeps overrides) + a Plan card on Tenant detail. **Create first admin** —
`POST /tenants/:slug/admin` (`provisioning.createAdmin`: Argon2id into the tenant LIVE schema, role default
CEO, audited) + a Create-admin modal — so a tenant can be onboarded entirely from the console (no CLI).
**Provisioning now seeds the tenant brand name** (`setting appearance.display_name`, both schemas,
`ON CONFLICT DO NOTHING`) from the provisioning display name, so a fresh tenant opens with a real name;
the tenant can still override it in Appearance.

**6. Human-readable sweep (both apps).** **Notifications** (the Watch-the-Watcher fan-out in
`shared/events/emit.js`) baked raw event keys + full UUIDs (`permission.changed on permission:<uuid> by
<uuid>`) which the `.micro` style then UPPERCASED — now it humanizes the event, resolves the actor UUID to a
name, and shortens the entity ref; FE `governance/pages.tsx` drops `.micro` on the body and runs
event/action columns through `enumLabel`. **`CrudResource`** default cell + settings `master-data-pages.tsx`
`cell()` now route through **`smartCell`**, so Fleet/WMS/HR tables and the FX Exchange-rates table show
readable dates/decimals instead of raw ISO/`1300.00000000`. **Platform console** Audit/Overview/TenantDetail
activity humanized (`humanizeAction`, `kvSummary`, `enumLabel` added to `platform-console/src/lib/format.ts`).
**`(MOD-xx)` stripped** from the document-module dropdown (`config-pages.tsx`) and the permission-matrix
popover subtitle (kept as a hover title).

**7. UI fixes (all user-screenshot-driven).**
   - **Permission-matrix popover** (`security/permission-matrix-page.tsx`) opened far from the clicked cell —
     a transformed page ancestor broke `position:fixed`. Now **portaled to `document.body`** + anchored to
     the cell (flips above when tight). Same root cause + fix applies to the FAB below.
   - **Draggable floating pin** (`components/floating-actions.tsx`): now draggable (press-drag the FAB,
     position persisted to localStorage), **portaled to body** (fixed = viewport) and anchored by the
     **right/bottom edge** so it doesn't drift when the cluster expands; hover-open suppressed mid-drag. A
     **live clock** was added to the cluster, replacing the Lovable mock's standalone floating clock.
   - **Lovable-mock chrome removed**: the mock's orange sun `.fab` and clock `.floatbar` are now hidden via
     the dashboard iframe's `HIDE_CHROME` (`features/dashboard.tsx`).
   - **Header**: the duplicate **Messages** icon removed (it lives on the floating pin); only Notifications
     stays. `ChatIcon` def removed (unused).
   - **Browser tab title** now shows the tenant brand name (`branding-context.tsx` sets `document.title` in
     `paint()`), falling back to "Praxis LS".
   - **Appearance form re-sync**: its fields were seeded from `branding` once at mount, so a hard reload
     landing on that page captured the pre-fetch defaults ("Praxis LS" + default colours) and never
     re-synced. Now re-seeds once when branding becomes `ready` (guarded so it never clobbers edits/saves).
   - **Console Overview** "Provisioning 0 / everything 0" was a stat bug: it counted **Live by `is_live`**,
     so a provisioned tenant (status=LIVE but `is_live=false`, i.e. not yet gone-live) fell into no bucket.
     Now counts **by status**, so every tenant lands in exactly one.

**8. Owed / notes.** Apply **0031** (+ 9112) to the platform DB and **restart the API** for the BE changes;
`db:migrate:platform && db:migrate:tenants` (what the deploy `migrate` service runs) covers both tiers + the
re-projection. Platform-tier 2FA still 501 (unchanged). Platform refresh is stateless (no remote-kill /
reuse-detection at this tier — would need a platform session table). The `TanStack Query` adoption (to kill
the on-reload skeleton flash via caching) was discussed and **not** done — an incremental option that wraps
the existing `api-client`.

## Session log — 2026-07-23 (session 13: Platform Console built + Support & Feedback end-to-end)

Two things: (1) built the **Platform Console** — the Praxis-side admin UI over `/api/platform/*` that had
never had a frontend; (2) shipped **Support & Feedback** (PRD §11.2) end-to-end. **Verified in-sandbox this
time:** console `tsc -b` + `vite build` clean, full client `tsc -b --force` clean, all touched BE files
`node --check` clean. **Not run against a live API** — Windows validators + a click-through still owed.

**1. Platform Console — new standalone app `platform-console/`.** Chosen with the user: a *separate*
React 18 + Vite 5 + TS app (its own toolchain, `npm install` not `ci` — same Windows-lockfile caveat as
`client/`), **not** folded into the tenant `client/` (different auth, must never touch tenant data). No
Tailwind — plain CSS with a distinct dark "ops" palette (brand orange/blue accents) so it's unmistakably
the Praxis side. HashRouter (no server-side SPA fallback needed). Structure: `src/lib/` (`api.ts` typed
`/api/platform` client + `localStorage` token store + `ApiError` w/ 401→reauth; `types.ts`; `format.ts`;
`useAsync.ts` load/reload hook), `src/components/` (`ui.tsx` Button/Field/Pill/Card/Modal/ConfirmModal/
Loading/Empty, `Shell.tsx` topbar+nav, `Toast.tsx` context), `src/features/` (Login, Overview, Tenants,
TenantDetail, Plans, Catalogue, Audit, Support). Covers **everything the BE already supported** plus the
two new BE bits below. First login needs a Root Admin (`scripts/platform/create-admin.js`); platform-tier
2FA still returns 501 (unchanged).

**2. Host-gated serving — the isolation rule.** The console is served by the **api container itself**
(baked in via a new Docker **`consolebuild`** stage → `COPY --from=consolebuild … ./platform-console/dist`),
but `src/server.js` serves it **only when `req.hostname === config.PLATFORM_CONSOLE_HOST`** (new env,
default empty), at that host's **root**, and **skips the tenant SPA on that host**; on every tenant host the
console middleware is skipped. Net: `admin.example.com` → console; `tenant.example.com` → tenant app;
**no `/console` path exists** so a tenant host can't reach the console at all. `.env.example` +
`DEPLOYMENT.md §5b` document it (the existing `*.domain` nginx wildcard already routes `admin.*` to the api
with Host passthrough, so no new nginx block is required — just set the env). CORS: admin is a subdomain of
`APP_BASE_DOMAIN`, already auto-allowed; a fully-separate host is a `CORS_ORIGINS` entry.

**3. New BE `GET /api/platform/audit`** (read-only). `tenants.service.recentAudit({slug,limit})` reads
`platform.platform_audit` LEFT-joined to `platform_user` (actor name/email) + `tenant` (slug/name),
optional `?tenant=<slug>` scope, `?limit` capped 1–500. Wired through the platform controller/routes
(before `/tenants/:slug`, distinct path). Powers the console **Audit** page and the per-tenant activity card
on Tenant detail. No schema change.

**4. Support & Feedback (PRD §11.2) — both halves + tenant FE.** The table `platform.support_ticket`
**already existed** in `0030_platform_ops.sql` (central, keyed by `tenant_id`) — so tickets live in the
platform DB and the console triages across all tenants **with no cross-tenant fan-out**, and **no migration
was needed**.
- **Tenant BE — new `src/modules/dashboard/support/`** (auto-mounts at `/api/tenant/support`, **ungated**
  `feature:null` — reaching Praxis for help must never be switchable off; `authMiddleware`). `POST /tickets`
  (kind SUPPORT|BUG|FEATURE, title, body, context), `GET /tickets` (this tenant only), `GET /tickets/:id`,
  `POST /tickets/:id/csat` (1–5, **only on SHIPPED/DECLINED**). Every query scoped to `req.tenant.tenant_id`,
  stamped with `req.user.email`; writes the platform DB via `services/platform/db` (the deliberate
  cross-boundary write — the store is platform-side by design).
- **Platform BE — new `services/platform/support.service.js`** + `GET /api/platform/support/tickets`
  (aggregate across tenants, joined to tenant names, `?status/kind/tenant` filters), `GET /tickets/:id`,
  `PATCH /tickets/:id` status transition (NEW→TRIAGED→IN_PROGRESS→SHIPPED/DECLINED, validated, **audited
  `support.status_changed`** into `platform_audit`). New `ticketStatus` zod schema in the platform validator.
- **Console FE** — the **Support** tab is a live triage board: five status lanes with counts, kind/tenant
  filters, per-ticket detail modal (body + context JSON + requester) with status-transition buttons.
- **Tenant FE — `client/src/features/support/support-page.tsx`** (route `/support` in `app.tsx`, nav under
  Overview in `app-shell.tsx`): KPIs, "Raise a ticket" modal (kind/title/body), tickets `DataList` with
  kind/status pills, and a 1–5 CSAT picker on resolved tickets. Built on the client's real primitives
  (`tenant()`/`useList`/`PageHeader`/`DataList`/`Modal`/`Field`/`Select`/`Pill`/`KpiRow`).

**5. Owed / next.** Windows `npm run lint` + `npm test` + `npm run build --prefix client`; `npm install` in
`platform-console/`; set `PLATFORM_CONSOLE_HOST` and redeploy; create a Root Admin; live click-through of
both the console and the tenant→console support loop. No new tenant migrations (support table pre-existed;
audit endpoint is read-only). The tenant support page has **no RBAC gate beyond auth** — if "visible to
admins only" is wanted later, add a permission key (there's no support permission today).

**6. CI `docker-build` fix (post-session).** GitHub CI's `docker-build` job failed in the new
**`consolebuild`** stage: `npm install --prefix platform-console` threw `npm error Invalid Version:` on
the Linux runner. Root cause: `platform-console/package-lock.json` carried a **malformed `fsevents` entry**
(`node_modules/vite/node_modules/fsevents` had only `{dev, optional}` — no `version`/`resolved`/`integrity`/
`os`/`engines`), a Windows-npm lockfile artifact for that macOS-only optional dep. On Linux, npm's dedup
pass calls `semver.gte` on the empty version and throws, killing the stage (never hit on Windows/macOS
where the entry is skipped or complete). **Fix:** completed that entry to a full record matching the valid
sibling under `rollup` (`version 2.3.3` + resolved/integrity/os `["darwin"]`/engines). Verified: clean
`npm install` reproduces green in a Linux sandbox; the root and `client/` lockfiles were checked and are
clean (no other missing-version entries). One-line lockfile change; nothing else touched.

## Session log — 2026-07-22 (session 11: verification, sandbox tooling, FE CRUD, real-time comms, portal auth, FE polish)

A large batch. **In-sandbox validation was not possible for most of it** (the workspace shell was
flaky and the DB/API run on the user's Windows box), so **treat the first Windows `npm run build
--prefix client` + `npm run lint` + `npm test` + a server boot as authoritative.**

**0. Verification first — most "pending" work was already built.** Read the code rather than the
stale docs: **tax filing** (`tax_declaration.routes.js` has `POST /declarations` + `/approve` +
`/submit`, and the FE `DeclarationsPanel`/`FileDeclarationForm`/`SubmitDeclarationForm` in
`finance/pages.tsx`), **asset depreciation/disposal** (`asset` MOD-54 `/depreciate` + `/dispose`),
**portals** (client/investor/auditor scoped views), **Smart Comms** (channels/messages/reactions/
certify), and **payroll depth** (`hr/payroll/payroll.rules.js` is the full CNPS/IRPP/CAC/CFC/FNE
engine with compute-over-roster + a balanced auto-posted journal) are all present. Net: the FS
colleague's lane is further along than `WORK_TO_BE_DONE_NEXT.md` implies; that doc is stale.
**Support & Feedback dashboard (PRD §11.2) is genuinely not built** and is **held until the
platform/dev console exists** — it's a tenant→Praxis channel whose triage half lives on that console.

**1. Sandbox data tooling (new).** `scripts/tenant/seed-sandbox.sql` (+ thin `seed-sandbox.js`
runner) seeds a full Cameroon freight-forwarder dataset into the **sandbox schema only**
(`SET search_path = sandbox`), idempotent (guards on entity `SBX`). Two non-obvious things it must
do, discovered by running it: (a) **mirror identity users into sandbox** —
`INSERT INTO app_user SELECT * FROM live.app_user ON CONFLICT DO NOTHING` — because business tables
carry per-schema FKs to `app_user` (`invoice.issued_by`, the audit ledger actor, …) and
`sandbox.app_user` is otherwise empty, so any TEST-mode write 23503s. **⚠️ This is a real latent gap
for TEST mode generally — the app should replicate identity into sandbox at provision / sandbox-wipe,
not just in the seed.** (b) **seed accounting journals (VT/AC/BQ/PAIE/OD) + an OPEN
`accounting_period` per entity** — posting looks both up by entity, and a raw-SQL entity insert
skips whatever normally creates them. Finance docs are seeded pre-posting (no journal rows), so the
GL stays clean.
`scripts/tenant/seed-money-path.js` is the **API-driven** complement: logs in, runs against sandbox
(`X-Praxis-Env: sandbox`, refuses if the tenant `is_live`), and drives the real endpoints —
advance → invoice draft/submit(auto-post) → receipt post → payroll compute→SUBMITTED→APPROVED→
VALIDATED → asset depreciate — so trial balance / statements / true ageing populate. **Idempotent
per period** via a marker in the settings store (`/settings/seed/money-path`). Target host defaults
to `localhost:<PORT>` (Windows binds Node on IPv6 `::1`; `127.0.0.1` may be another service); it
does a `/api/health` preflight. Doc: `doc/SANDBOX_TESTING.md`.

**2. S3 storage driver.** `services/storage.service.js` now ships `local` (default) + `s3` behind
`STORAGE_DRIVER`. The `s3` driver targets any S3-compatible store (AWS/MinIO/Wasabi/B2/R2) via
`S3_ENDPOINT/BUCKET/REGION/ACCESS_KEY/SECRET_KEY/FORCE_PATH_STYLE` (all in `env.js`) + optional
`CDN_BASE_URL`, adds `signedUrl(key, ttl)` (presigned GET), and **lazily requires** the AWS SDK so
local installs don't need it. `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` added to
`package.json` — **`npm install` at the repo root** before `STORAGE_DRIVER=s3`. Supersedes the PRD
§8 "no S3" line (S3 is now opt-in; local stays default).

**3. Fleet / WMS / HR FE — full CRUD.** New shared **`client/src/components/crud-resource.tsx`**
(`CrudResource`): list + create/edit/delete from a declarative `fields` spec that matches the BE
zod validators (numbers coerced, empty optional UUIDs omitted, FK `<select>` pickers from an
`optionsEndpoint`), and **resolves FK columns to human names** in the table. All three lanes
(`features/fleet|wms|hr/pages.tsx`) are now thin field-specs on it — converted from read-only
`ResourceList` skeletons. Field bodies were written against each module's actual validator.

**4. Smart Comms real-time.** New **`src/realtime/index.js`** (socket.io on the same HTTP server;
`initSocket` wired in `server.js`). Authenticated exactly like HTTP (JWT + host→tenant + active-user
check), **membership re-checked on every `channel:join`**, tenant-namespaced rooms
(`t:<slug>:c:<groupId>`). `smartcomm.service` publishes after each committed write (post/edit/delete/
react/read) + a typing indicator. FE: `client/src/lib/comms-socket.ts` (`useCommsChannel`) wired
into `features/comms/team-chat.tsx` (live messages + typing; the 8s poll stays as a fallback).
`socket.io-client` added to `client/package.json` — **`npm install` in `client/`.**

**5. Portal external-user auth.** New **`src/modules/portal_auth/`** + migration
**`0460_portal_user.sql`**. Public `POST /portal/auth/login` issues a portal-scoped JWT
(`typ:"portal"`, off the RBAC path); `portalAuth(type)` re-checks the existing `portal_access` grant
per request (revoke is immediate) and injects the scope; `GET /portal/{me,client,investor,auditor}`
reuse `portal.service`'s scoped views; staff invite/manage via `MOD-67`-gated `/portal/users`.
Auto-mounts at `/portal` (feature null → login ungated). **Apply migration 0460 to each tenant
(live+sandbox).** FE portal *pages* still pending.

**6. Early-logout fix (auth).** Access TTL is 15m; on refresh the BE **rotates** the refresh token
and **revokes the session on reuse** (any stale refresh presented after rotation). `auth-context`'s
boot restore did its **own** `/auth/refresh` that raced `api-client`'s de-duped one — and React
**StrictMode double-invokes** the boot effect in dev — so two refreshes fired with the same token →
the second looked like reuse → session revoked well before the 30-min idle window. Fix: exported
`tryRefresh` from `api-client` and the boot restore now uses it, so **every** refresh in the tab
(boot, StrictMode, 401-retries) collapses into one rotation. Remaining edge: **multiple tabs** (the
de-dup is per-tab) — offer a cross-tab lock or a one-generation BE grace if it recurs.

**7. FE polish pass.**
   - **Command palette** (`components/command-palette.tsx`) rebuilt to the Pixie design: **JUMP TO**
     (areas w/ icons) + **ACTIONS** (New file / New invoice / File a tax return / Open Messages /
     **Ask Praxis AI…**). "Ask Praxis AI…" opens the copilot via a `praxis:open-copilot` window event.
   - **Header** (`app-shell.tsx`): inline nav Control Tower · Operations · Fleet · Finance · More;
     right cluster = Search · Live/Test · theme · **Messages** + **Notifications** icon links (with
     **unread badges** from `/smartcomm/unread` [summed] + `/notifications/unread-count`) · **user
     avatar menu** (name/email · My security · Appearance · Sign out), replacing the email+Sign-out.
   - **Floating action cluster** (`components/floating-actions.tsx`): Pixie floatbar — primary FAB
     (unread badge) that **opens on hover**, expanding to Praxis AI (gated on `useAiEnabled`),
     Messages, Help. The copilot's standalone launcher was removed; the cluster opens it. **Help →
     new `/help` Help center page** (`features/help/help-page.tsx`).
   - **Dark-mode `<select>`** fixed in the shared `Select` (solid bg + explicit `[&>option]` colours).
   - **Login brand** "The Pixie Hub" → tenant brand name, fallback **Praxis LS** (`login-modal.tsx`).
   - **Theme toggle** is Light/Dark only now; "system" is just the silent initial default.
   - **Appearance preview** now reflects **all** settings live (name, logos, all colour tokens, the
     status tokens, display/body/mono fonts, radius, light/dark).
   - **Human-readable data**: `lib/format.ts` gained `dateTimeFmt`, `humanizeEvent`, `humanizeRef`;
     the workspace activity feed (`workspace-page.tsx`) and the journal-entries date
     (`finance/pages.tsx`) now render readable values instead of raw event keys / `type:uuid` / ISO.
     Rule written into **`doc/FE_DESIGN_RULES.md` §5**.

**8. Docs updated:** `FE_DESIGN_RULES.md` (§5 human-readable data, `CrudResource`, dark-mode select),
`WORK_TO_BE_DONE.md` (S3 done; portal external-user auth done + apply 0460; Support & Feedback held),
`SANDBOX_TESTING.md` (money-path seeder), and this handoff.

**⭐ ~~Next (owed)~~ — DONE (2026-07-22, session 12): operations 360° modal full-match.**
- **BE** — `operations_file.repo.overview()` extended: costing rollup now splits
  `planned_service_cost` / `planned_debours` (FILTER on `cl.is_debours`); the FINAL-invoice rollup
  adds `billed_service_ht` / `billed_debours` / `billed_vat` (locked statuses only, same filter as
  `billed_ttc`); new **people** queries (latest costing preferring `APPROVED_LOCKED` → validator +
  approver; latest locked FINAL invoice → issuer + validator + approver, names via `app_user`
  LEFT-joined **in the env schema** — sandbox relies on the identity mirror, missing mirror just
  yields null names); new **documentRows** (transit `ot_number AS ref` / delivery `doc_number AS
  ref` / non-archived vault docs, 20 each). `service.overview()` composes a **`money`** block
  (billed service HT / débours / TVA / `revenue_ht` / TTC, planned split, actual, **`dossier_margin`
  = HT revenue − actual costs** + `margin_percent`, `budget` via costing.rules `reconcile`) and a
  **`people`** block. ⚠️ **Margin keys deliberately named `dossier_margin`/`margin_percent`** so the
  existing `dossier.margin` field-mask nulls them for Sales/Ops with zero new mask code. Old
  payload keys all preserved (additive).
- **FE** — `lib/operations-api.ts` `DossierOverview` extended (money / people / document_rows);
  `Dossier360Modal` in `features/operations/pages.tsx` rebuilt into **Milestones / Money / People /
  Documents** tabs (`Segmented` from `features/sales/ui`), stat strip kept above the tabs. Money tab
  shows **"Restricted for your role."** when `dossier_margin` arrives null (masked). People tab =
  Costing (validator/approver) + Final invoice (issuer/validator/approver) cards with doc number +
  status pill + initials avatars. Documents tab = count tiles + vault/transit/delivery row lists.
- **Not verified in-sandbox** — the workspace shell would not start this session (disk space), so
  no `node --check`/`tsc`. Code reviewed by hand. **Windows `npm run lint` + `npm test` +
  `npm run build --prefix client` + a visual pass of the modal (all four tabs, and once as a
  margin-masked role) are owed.**

**Also session 12 — Finance hub human-readable pass (§5) + sandbox seed stale-identity fix.**
- **Seed fix (BE tooling):** on a machine switch, a re-created live admin (same email, NEW
  user_id) collided with the stale sandbox `app_user` row on the UNIQUE email — the mirror's bare
  `ON CONFLICT DO NOTHING` silently dropped it, so every TEST-mode write 409'd ("Referenced record
  not found", FK 23503 on the actor). `seed-sandbox.sql` now **tombstones** the stale row's unique
  keys (email → `<uuid>.stale@sandbox.invalid`, username NULL, SUSPENDED — can't delete, old
  documents reference it) before mirroring `ON CONFLICT (user_id)`. Re-running the seed is the fix;
  no wipe needed. `SANDBOX_TESTING.md` updated (its "sandbox has no app_user rows" line was stale).
- **New `lib/format.ts` helpers:** `enumLabel()` (SCREAMING_SNAKE → "Sentence case"; tokens without
  underscores keep case so "DRAFT"/"XAF" survive) and `smartCell()` (generic §5 cell: ISO datetime/
  date → dateTimeFmt/dateFmt, UUID → 8 chars, decimal strings ONLY → grouped — integer strings stay
  raw, they may be account codes/years — arrays → "N items", objects → "k: v" pairs, never raw JSON).
- **Applied:** shared `ResourceList` fmt → `smartCell` (helps every remaining stub screen incl.
  AssetsPage); finance `pages.tsx` `fmtCell`/`fmt` → `smartCell` (imported `money as moneyFmt` —
  a local fr-FR `money` at :93 would collide); InvoicesPage gained a **Client** column (loadClients
  map) + money/dateFmt/enumLabel cells; CreditNotesPage + Tax declarations cells (money/dateFmt);
  `hub.tsx` invoice **Dossier** column resolves `dossier_id → ref` via `/operations` (was `…last4`),
  proforma lead column is now Created date (was a bare advance UUID), all status/method/source pills
  → `enumLabel`; `receivables.tsx` ReceiptDrawer allocations resolve `invoice_id → doc_number`
  (falls back to "Invoice ab1b7b30"), drawer/list pills → `enumLabel`.
- Verified by hand only (sandbox shell still down); Windows validators + a visual pass owed.

**Session 12 (cont.) — user visual-pass feedback fixed + Docker deployment made real.**
- **Statements `Report` viewer rebuilt** (`finance/pages.tsx`): payloads like the trial balance
  (`{rows, totals}`) now render the rows array as a real table + a titled totals card (was
  "rows: 5 items"); nested figure groups like the notes' `class_balances` render as their own
  card with "Class 1…9" labels (single-digit keys = SYSCOHADA classes). Split into
  `ReportTable`/`KVCard`, generic over arrays/objects/scalars.
- **ProformasPage rebuilt off `ResourceList`** — the deep page showed raw inferred columns
  (ADVANCE_ID/CLIENT_ID/DOSSIER_ID). Now: Received (dateFmt), Client (name), Dossier (ref),
  Amount/Applied/**Open** (computed amount−applied) via `money()`. Kept the Record-advance
  modal + quotations link.
- **Docker deployment (new `doc/DEPLOYMENT.md` + fixes):** the existing image had **no SPA**
  (server serves `client/dist`, but no stage built it) → new `clientbuild` stage; **`npm ci`
  swapped for `npm install`** in both stages — the Windows-generated lockfiles omit
  linux-musl platform binaries (sharp/argon2/rollup), `ci` would ship a crashing image;
  `.dockerignore` now excludes `doc/` (the legacy-codebase sample uploads are huge),
  `**/node_modules`, `postman/`, `data/`; compose mounts **`./data` (document vault)** in
  api+worker (was silently ephemeral) and binds Postgres/Redis to **127.0.0.1** only.
  DEPLOYMENT.md = full server runbook: wildcard DNS + Host-passthrough + WebSocket-upgrade
  nginx config (both non-negotiable), .env table, migrate/provision/create-admin commands,
  update procedure, backups, troubleshooting. ⚠️ Image build not verifiable in-sandbox —
  **first `docker compose build` on the server is the test**; blank page at `/` = clientbuild
  stage didn't run.

**Session 12 (cont. 2) — LIVE DEPLOY + branding seed + CI/CD.** The app is **deployed and
running** at `smartls.praxisls.com` (VPS 51.254.165.120, Cloudflare DNS-only wildcard).
Deploy shakeout fixed en route: client build needed `@types/node` (only ever transitive on
Windows) + an unused React import in `help-page.tsx`; **`TENANT_DB_HOST_DEFAULT` must be
`postgres` in compose** (the migrator ignores `DB_HOST`; its AggregateError has an empty
message — db-script error prints fixed); env guard rejects default `ENCRYPTION_KEY` in prod
(by design); **`seed-money-path` now uses `node:http` because undici's fetch silently drops
the `Host` header** (tenant resolved as 'api' → 404; workaround was `--url=https://<tenant
domain>`). New: **`scripts/tenant/seed-branding.js`** (Lovable palette — orange #F5821F,
Playfair/Montserrat, status colours — into `setting` section='appearance', both schemas,
non-clobbering unless `--force`; deliberately skips secondary/accent surface tokens).
**CI/CD:** `deploy.yaml` now real — triggers on CI success on main, SSHes and runs new
**`scripts/deploy.sh`** (build → `compose run migrate` → roll **api-standby** → roll api →
worker). Zero-downtime = new `api-standby` service on :3001 + nginx `upstream` with
`backup` (config in DEPLOYMENT.md §5) — standby idles unless the primary is down, which
also sidesteps socket.io cross-instance fan-out. Healthchecks added to api services
(`--wait` depends on them). ci.yaml: `npm ci`→`npm install` (Windows lockfile omits Linux
platform binaries). Secrets needed on GitHub: `DEPLOY_HOST/USER/SSH_KEY`.
**CSP fix (prod-only bug):** helmet's default CSP (`script-src 'self'`, `script-src-attr
'none'`) broke the Control Tower — the `<iframe srcDoc>` mock inherits the parent CSP, and
its live-data bridge is an inline script + inline `onclick=` handlers. Never seen in dev
because Vite serves without helmet. `server.js` now sets an explicit CSP: default helmet
directives with `script-src`/`script-src-attr` `'unsafe-inline'` and `img-src` + https:/
blob:/data: (tenant-authored image URLs). **Tightening owed:** per-route CSP for the mock
or convert its handlers to addEventListener, then restore defaults.
**Lovable-fidelity polish (user compared prod side-by-side with the Lovable app):** the gap
was detail-level, fixed in the shared kit so every screen benefits: (i) **`Pill` now
humanizes string children** via `enumLabel` ("POSTED_LOCKED" → "Posted locked"; enumLabel
also sentence-cases bare ALL-CAPS words ≥4 chars — "OPEN" → "Open"; ≤3-char codes XAF/TVA
keep case); (ii) **`TH` is whitespace-nowrap** (headers never wrap); (iii) new
**`money0()`** (grouped, 0dp, no suffix, 0/null → "—") for columns whose header carries the
currency; (iv) operations list: nowrap on ref/client/service/route/costing columns,
costing → money0, milestone cell shows "No milestones yet" instead of an empty bar + "0%".
Seeded branding also now covers the **login hero** (section='login': headline/subtext/
split/show_logo + a self-contained SVG navy-mesh background) — a fresh tenant's landing no
longer falls back to bare generic copy. **Deeper per-screen fidelity vs the reference mock
(doc/reference/reference-mock-lovable, read the v-<area> section first) remains available
as a proper design wave — the full audited plan for it is in
`doc/LOVABLE_FIDELITY_PLAN.md`** (exact reference values per component, per-file
workstreams, execution order, constraints; audit done, kit restyle not started).

## Session log — 2026-07-20 (session 10: feature-gate root cause, merge audit, Pixie matrix, Control Tower de-mock)

Started from two reports: "Role & Permission matrix isn't up to standard, per the lead" and "some pages say
access denied on a **CEO** account". The second turned out not to be RBAC at all. **All in-sandbox `tsc
--noEmit -p client` clean; BE `node --check` + `eslint` clean (0 errors, 0 warnings). Windows `npm run lint`
/ `npm test` / `npm run build --prefix client` still authoritative.**

1. **Merge audit (asked for before anything else).** `main` was at `e68a8df`, working tree clean. **PR #13
   (`3833bc9`) merged session 9 in and everything survived** — both hubs, the routes, `GET
   /receivables/overdue` still registered before `/:id`, `MERGE_FIELDS`, Governance, the 5 new tests.
   The colleague's newer `e68a8df` collapsed **fleet (7 routes) + wms (6)** into `FleetHub`/`WarehouseHub`
   using the shared **`TabbedHub`** (not the `features/security/{pages,hub}.tsx` pattern the session-9 note
   recommended — his choice works, just be aware there are now two hub idioms). Old deep paths still
   resolve as `:section`. **Three things to know:**
   - ⚠️ **He edited the shared `components/resource-list.tsx`** — `ResourceList` now renders `<HubTabs />`
     under its header and takes an `eyebrow` passthrough. Safe today (`HubTabs` reads a context defaulting
     to `null`, and no current `ResourceList` consumer sits inside a `TabbedHub`), but the invariant is now
     *"any `ResourceList` inside a `TabbedHub` draws a tab bar."* **Master data is the only `inlineTabs`
     hub; the day one of its 8 tab pages uses `ResourceList`, you get two tab bars.**
   - Nav collapsed to one entry per area, so the **13 fleet/wms sub-screens are no longer findable in ⌘K**
     (the palette filters `NAV`). Security/Vault kept per-section entries — the two lanes are inconsistent.
   - ⚠️ **`client/vite.config.js` + `vite.config.d.ts` are committed build output of `vite.config.ts`.**
     Vite resolves `.js` **before** `.ts`, so **the `.ts` is dead config** — future edits to it silently
     no-op. Contents are currently equivalent so nothing is broken. Both are now in `.gitignore`; the
     `git rm` is still owed (see "First thing to do").

2. **THE BIG ONE — CEO "access denied" was the feature gate, not RBAC.** Two things 403 and they look
   identical in the UI: `requirePermission` (`middleware/rbac.js`, **CEO bypasses** via
   `bool_or(r.code='CEO')`) and `requireFeature` (`middleware/feature-gate.js`), which `module-loader.js:67`
   mounts **in front of the entire router** and which **nothing bypasses — not the CEO, not the owner**.
   Root cause is in `provisioning.service.js projectFeatures()`:
   ```sql
   CASE WHEN ov.state IS NOT NULL THEN ov.state          -- per-tenant override
        WHEN pf.included          THEN fc.default_state  -- plan says yes... but THIS decides
        ELSE 'off' END
   ```
   Plan inclusion **defers to `default_state`** rather than turning anything on, so smartls — on the
   **full** plan, which includes every feature — still inherited `off` for nine keys. **Measured before:
   `84 modules mounted · 17 gated+ON · 19 gated+OFF`**, the 19 being fleet ×6, wms ×3, wms.inventory ×2,
   fleet.maintenance, wms.cycle_count, hr.recruitment, hr.appraisals, hr.training, finance.debt, ai ×2.
   **Fix:** flipped those nine to `'on'` in `9110_seed_platform_features.sql` **and** added
   **`migrations/seeds/9111_fix_feature_defaults.sql`** — the second file is not redundant: platform seeds
   apply via `migrator.applyTracked()` with scope `platform-seed`, which **skips any filename already in
   `public.schema_migration`**, so editing 9110 only ever affects databases built from scratch.
   **Ran on Windows: `db:migrate:platform` → `db:migrate:tenants` → 19 dark became 2** (live and sandbox
   both), the remaining 2 being `ai.assistant.backend`, deliberately off. `9100` also seeds
   `feature_catalogue` and is **not authoritative** (9110 upserts over it) — flagged in-file.
   **The rule now written into 9110: `default_state` answers "is this module SHIPPABLE?", not "did the
   customer buy it?" — entitlement is `plan_feature`'s job, exceptions are `tenant_feature_override`'s.**
   **New `scripts/tenant/feature-report.js`** (read-only, safe against prod): parses every
   `*.routes.js` for its `feature:` key, reads the tenant's `feature_state` for both schemas, and prints
   which mounted modules are dark and why. Also flags child-on/parent-off, since **`depends_on` is stored
   in the catalogue but nothing enforces it at projection time** (unfixed).

3. **Latent SQL bug exposed by the unlock — `ce.name` does not exist.** `corporate_entity` has
   **`legal_name`** (`0100_identity.sql:18`). Four occurrences, `get` + `list` in each of
   `fleet/vehicle/vehicle.repo.js` and **`master/employees/employees.repo.js`**. Fleet's was invisible
   because the module was gated; **employees was never gated, so `/employees` list and detail have been
   500ing since the module was written — HR Employees has never worked.** That's the FS colleague's wired
   screen. Audited every other join in the 19 newly-unlocked modules against its `CREATE TABLE`
   (`e.full_name`, `e.cnps_number`, `wl.zone/aisle/rack/bin`, `kt.metric/target_value/weight`, all `v.*`) —
   all clean. **Caveat: that audit covered joins, not every column each repo selects from its own primary
   table.** These 19 modules are executing for the first time; more of this class is plausible. Clicking
   each Fleet/WMS tab with the server log open is the fast way to flush the rest out.

4. **Permission matrix rebuilt to the Pixie reference** (`features/security/permission-matrix-page.tsx`).
   Source: the user's screen recording of Pixie's *Org & Workflow › Permissions* (that hub is 4 tabs —
   Org Chart / Permissions / Workflows / Pending — worth knowing if we ever build the other three).
   **Transposed to roles-as-rows / modules-as-columns** under spanning group headers, sticky role column,
   horizontal scroll. The old layout was modules-as-rows × roles-as-columns with **five letter buttons per
   cell** — 350+ hit targets on screen; that density is what the lead was reacting to. Each cell is now
   **one dot showing the strongest grant**, coloured from theme tokens (`--ink-3` / `--primary` / `--warn` /
   `--bad` / `--ok`; note `--primary` is a full `rgb()` and must **not** be wrapped in `rgb(var(…))`, and
   there is still no `--info` in `index.css`). Editing is preserved — clicking a cell opens a **popover**
   with the five real toggles, `position: fixed` off the cell rect because the scrolling grid with sticky
   columns would clip an absolutely-positioned child. Plus legend, module search, and a New-role link to
   `/security/roles` (reuses the existing CRUD rather than duplicating it).
   **Two deliberate departures from Pixie — raise these before the lead reads them as misses:** (i) no
   **Export** dot — Pixie's legend has six, our `permission` table has five booleans and `rbac.js` maps
   `export`→`can_read` as a placeholder, so a sixth would advertise a grant that doesn't exist; (ii) the
   **ceo row renders lit-and-locked**, because `requirePermission` short-circuits on `role.code='CEO'` and
   never reads those grants — the old page said so in a footnote while still offering toggles that did
   nothing.

5. **Control Tower de-mocked** (`features/dashboard.tsx`). Audited the whole mock against what the
   injection overrides. Now routed through the parent via `postMessage` (iframe sends an identifier only;
   the parent owns every id→route map, so the iframe can't reach an arbitrary path):
   - **Application launcher** — `renderApps()` hardcodes `onclick="go('ops')"` on **all twelve tiles**, so
     Settings, Treasury, CRM et al. every one opened the mock's sample Operations view. New `APP_ROUTE`
     keyed by the tile's visible label (the only identifier the mock's `apps` array carries). Tiles also
     got `role="link"` / `tabindex` / Enter-Space — they're divs, so they were mouse-only.
   - **Live shipment rows** — the injected `liveRow()` had already dropped the mock's `openDossier()`, so
     these carried **real refs but did nothing on click**. They now post the ref; the parent deep-links
     `/operations/files?ref=…`, and `OperationsFilesPage` seeds its existing search box from that param
     (there is no dossier-detail route to send them to).
   - **Hero CTAs** ("New Operation File" / "New Invoice"), the **floating search FAB** (`HIDE_CHROME` hides
     the topbar/botnav/drawer palette triggers but not `.fab`), and **clock in/out** (was fabricating
     "8h 12m today" — now goes to `/hr/attendance`).
   - **Greeting** — `script.js:414` computes time-of-day but **hardcodes "Amara"**; now uses the signed-in
     user's first name, falling back to the email local part, then to a bare "Good evening".
   - **Removed:** the **Recent activity** feed (four fabricated rows — Bolloré, MSC Lucia,
     SLAS-INV-2026-0314, truck LT-4471 — no endpoint exists) and the **mock Praxis chat**.
     ⚠️ **THE AI CHATBOT IS COMING BACK — this is a removal, not a decision.** What was deleted is the
     mock's fake panel: a live-looking input whose `praxisSend()` cycles canned replies on a 520 ms timer,
     opening with "Hi Amara — I'm tracking 7 live dossiers". The **real** assistant already exists app-side
     (`components/praxis-copilot.tsx`, mounted in `app-shell.tsx:614`, self-gating on `ai_enabled`). When
     the chatbot work lands: decide whether the floatbar entry point should return and open the *real*
     copilot (a `postMessage` type + a trigger on `PraxisCopilot`), and turn on `ai.assistant.backend` —
     which also needs a re-login, since the FE gate reads `user.ai_enabled` off the session payload.
   - **Map kept, badged `Sample view · not live`** (top-right, using the mock's own `st-mute` pill). Fixed
     geography, three hardcoded lanes. Wiring it to real vessel positions is deferred by decision.
   - ⚠️ All of the above lives in the **injection script**, which `buildSrcDoc` only includes when `live`
     is non-null. A failed fetch renders `ErrorState` instead of the iframe, so it's fine in practice — but
     if you want the removals unconditional, strip those blocks from `body.html.txt` directly.

6. **Loading states → content skeletons.** `LoadingRow` was a bare spinner in ~60 places. Added
   **`PageSkeleton`** (title / subtitle / toolbar / optional KPI tiles / rows) to `components/ui/skeleton.tsx`
   and used it for the three whole-screen loads (Control Tower with a 4-tile band, permission matrix,
   numbering scheme). Swapped **~35 list slots to `SkeletonTable`** — these pages already render their
   header first, so the skeleton lands exactly where the rows will. **`LoadingRow` deliberately survives in
   the 9 genuinely inline spots** (modals, expanding panels, detail views: "Loading invoice…", "Checking
   credit…", "Running…"). `skeleton.tsx` documents which of the three to reach for. Note this covers *data*
   loading only — routes are still eagerly imported, so page switches don't suspend; if route-level
   `React.lazy` ever lands, `PageSkeleton` is the right `Suspense` fallback.

7. **Dead code.** Removed the `ReceivablesPage`/`ChartOfAccountsPage` `ResourceList` stubs from
   `features/finance/pages.tsx` (zero importers; `FinanceHub` takes both from the dedicated modules).
   `features/master/pages.tsx` (748 lines, zero importers) and the two vite artifacts still need `git rm`
   **on Windows** — the sandbox mount blocks unlink, and a failed `git rm` leaves a stale
   `.git/index.lock` (`Remove-Item .git\index.lock -Force`).

## Session log — 2026-07-19 (session 9: Security CRUD + hubs, Control Tower drill-downs, Governance, merge fields)

Prompted by the FS colleague's note that "modules under fleet, security, warehouse, vault, vehicle and hr
aren't built — collapse them into one screen as tabs like finance". **Audit correction: vault was already
built** (all five pages shipped session 8); **security was not** — `features/security/pages.tsx` was 104
lines of read-only `ResourceList` stubs, as its own header admitted. Split of work: this stream took
security + vault, he took fleet/warehouse/vehicle/hr. **All in-sandbox `tsc --noEmit -p client` clean; BE
`node --check` + `eslint` clean (0 errors). Windows `npm run lint` / `npm test` / `npm run build --prefix
client` remain authoritative — jest could not run in the sandbox this session (hangs with no output).**

1. **Security — full CRUD** (`features/security/pages.tsx`, 104 → 872 lines). `UsersPage` (create/edit,
   role assignment as toggle chips, status via the separate audited `POST /users/:id/status`, password via
   `/users/:id/password`; the edit modal re-fetches `GET /users/:id` because the list's `SAFE_COLS` omits
   `role_ids`), `RolesPage` (code locked on edit, delete disabled for `is_system`), `CapabilitiesPage`
   (code constrained to the DB CHECK's four values), `ScopesPage` (entity picker, parent select excluding
   self), `FieldVisibilityPage` (**needs `approve`, not `edit`** — that's how the router is gated),
   `SessionsPage` (mine + all, per-row revoke, revoke-all). Dead `PermissionsPage` export dropped —
   `app.tsx` always used `permission-matrix-page.tsx`.

2. **SecurityHub + VaultHub** (`features/security/hub.tsx`, `features/vault/hub.tsx`). FinanceHub-shaped:
   overview landing + tab bar + section map at `/security/:section` and `/vault/:section`. **Chose the
   finance pattern over the shared `TabbedHub`** because `TabbedHub` publishes its bar via context and
   expects each page to render `<HubTabs/>` — none of these eleven pages do, so it would have meant
   editing all of them or double-rendering headers via `inlineTabs`. Vault's five pages are untouched.
   `app.tsx` routes 13 → 4; **every old path still resolves as a hub section**, so nav, bookmarks, ⌘K and
   `screen-registry.json` all keep working. Nav gained "Security overview" / "Vault overview" entries.

3. **Control Tower KPI drill-downs — now real** (`features/dashboard.tsx`). Clicking a card used to open
   the mock's hardcoded `kpiData` (Bolloré, Sonara, LT-4471) even though the card *values* were live. All
   four now build from endpoints the user already reads: revenue → `/final-invoices` grouped by client
   (names via `/clients`), SLA → `/operations` scored `ata ≤ eta`, overdue → see §5, fleet → `/vehicles`.
   **No new drill-down BE.** Each fetch catches independently so a gated module yields that card's empty
   state. The mock's `openKpi` is **replaced outright** (its script is top-level with no IIFE, so its
   functions are window properties and the inline `onclick=` handlers pick up the override) — this also
   removes its simulated ~18% random load failure, which was fine for a demo and wrong for real data. The
   CTA now leaves the iframe: it posts `{type:'praxis-kpi-nav', id}` to the parent, which owns the id→route
   map, so the iframe can't navigate to an arbitrary path. Drill `meta` strings carry deliberate `<b>`
   markup so they're injected as HTML — interpolated DB values are escaped (`escHtml`), since the iframe
   runs `allow-same-origin`. **Fixed en route:** `rgb(var(--info))` was invalid — `--info` is a raw hex
   that `theme.ts` sets with the comment "no consumer yet", not an `R G B` triplet, and isn't in
   `index.css` at all; switched to `--ink-3`.

4. **Governance — the two stubs built** (`features/governance/pages.tsx`; `WorkflowsPage`/`ApprovalsPage`
   untouched). `AuditPage` is now four segments over the four things `/audit` actually exposes: **Ledger**
   (`immutable_ledger`, row → before/after JSON diff), **Security events** (`/audit/events`; these read the
   **live** schema by design, so they show identical rows under TEST — said so in the empty state rather
   than leaving it looking like a bug), **Access reviews** (create → decide each entry approved/revoked/
   flagged with a note → complete; Complete stays disabled until every entry is decided), **Restore queue**
   (`/audit/soft-deletes` request-restore + restore, with the maker-checker rule stated up front since the
   DB enforces `restored_by <> deleted_by`). `NotificationsPage` = inbox (unread filter, mark-read,
   read-all) + **Preferences** matrix over `GET/PUT /notifications/preferences`. Two constraints shaped it:
   the table stores **explicit opt-outs only** (absence of a row = enabled), so the grid defaults on; and
   `category` is free text server-side, so the six categories are a **UI convention** and any category
   already stored for the user is merged in. **No Governance hub** — its four screens sit at unrelated
   top-level paths (`/audit`, `/notifications`, `/workflows`, `/approvals`), so hubbing would move every
   URL for cosmetics.

5. **Past-due receivables reconciliation (BE+FE).** New **`GET /receivables/overdue`** (MOD-52, gated
   `accounting.core`) in `smart_receivables` — **no new SQL**, it reuses the same `repo.openInvoices` rows
   `ageing` reads, so `overdue.total === d1_30 + d31_60 + d61_90 + d90_plus` for the same `as_of` **by
   construction**. Verified on fixtures: total 1100 = ageing past-due 1100, with the not-yet-due invoice
   (250) correctly left in `current`. Route registered before `/:id`. FE: the Control Tower overdue card
   **and** its drill-down now read this one payload (previously card = ageing report net of receipts, list
   = raw invoices not net — they could disagree on screen). Amounts are `outstanding`, so a partly-paid
   invoice shows what's actually owed, and the card no longer depends on the `reporting` feature flag.

6. **Campaign per-recipient merge (BE+FE).** `sendCampaign` renders subject and body per subscriber:
   `{{name}}`, `{{email}}`, `{{campaign}}`, `{{year}}` (`MERGE_FIELDS`). Deliberate: **body values are
   HTML-escaped, subjects are not** — `name` comes from the public subscribe endpoint, so one subscriber
   signing up as `<script>…` would otherwise land markup in every other recipient's email; subjects aren't
   HTML but CR/LF is stripped (header injection). **Unknown tokens render literally** so a typo is visible
   in a test send instead of silently blanking. `name` falls back to the email local part, then "there".
   FE: `TemplateForm` lists the fields under the body. Five cases added to `tests/unit/campaign-send.test.js`
   (substitution, escaping, CRLF, unknown tokens) — **unverified, jest wouldn't run in-sandbox**; the
   underlying logic was checked directly via `node -e`.

7. **Docs + Postman.** `doc/CAMPAIGN_TEMPLATES_BE_HANDOFF.md` rewritten as a **record, not a request** —
   the endpoints it proposed shipped in session 8 and someone was going to build them twice; its remaining
   gaps (no SPF/DKIM behind `verified_at`, no scheduling) are now written down. The two "hand it to the BE
   dev" instructions below were corrected. Postman gained **`GET /receivables/overdue`** in folder 12 with
   tests asserting rows sum to total and every row is genuinely overdue.

**Dead code found (not deleted — mount blocks unlink, needs `git rm` on Windows):**
`client/src/features/master/pages.tsx` (748 lines) has **zero importers** — it was this stream's session-5
master-data trio, superseded at the PR #11 merge by his `masterdata/master-data-page.tsx`; deleting it
empties `features/master/`. Also `ReceivablesPage` + `ChartOfAccountsPage` in `features/finance/pages.tsx`
are `ResourceList` stubs nothing imports (`FinanceHub` takes both from the dedicated `receivables.tsx` /
`chart-of-accounts.tsx`). **Do NOT delete `features/dashboard-mock/`** — restored session 7 and actively
rendered; the session-6 "safe to delete" note is stale.

**Still stubbed, his lane (24 screens):** fleet (7), wms (6), hr (10) — all `ResourceList`-only — plus a
stray **`AssetsPage`** inside the otherwise-built `features/finance/pages.tsx`, which `/finance/assets`
routes straight at. Worth flagging: it's not in the four areas he named.

## Session log — 2026-07-18 (session 8: FE follow-ons + all pending BE jobs)

Two-part session. **Part A (FE follow-ons, all `tsc`-clean, recorded inline above):** converted the
remaining reference pickers to `SearchSelect` (session-7 log §4; added an optional `filter` prop);
built the Settings store tiles (`features/settings/store-pages.tsx` — document templates / custom
fields / email signatures / policies; session-7 log §9); built the **whole vault trio** (`DocumentsPage`
+ `SignaturesPage` + `VerificationPage` in `features/vault/pages.tsx`, routed); PWA `background_color`
now follows theme (`src/routes/pwa.js`); converted the opportunity win-form entity picker (and confirmed
`placeholder/coming-soon.tsx` was already deleted). QuickPIN marked done. Also built two more lane
screens: **Smart Comms** (`features/comms/pages.tsx`, `/comms` — feature `comms`; two-pane channel list
+ thread + composer + new-channel modal over `/smartcomm`) and **My Workspace** (`features/workspace/
pages.tsx`, `/workspace` — greeting + awaiting-approval + notifications + quick links), both routed
(replaced `<Planned/>`).

**Part B — all pending BE jobs, built BE-then-FE (BE `node --check` + `eslint` clean; client `tsc`
clean; `npm test` + Windows lint/build authoritative — sandbox can't run DB tests):**

1. **Dashboard KPI aggregates (BE+FE).** `dashboard.repo.js kpis()` gained guarded `revenue_final_ttc`
   (Σ locked FINAL invoice TTC — nominal, not FX-consolidated), `revenue_currency`, `fleet_active`/
   `fleet_total` (vehicle counts), and `sla_on_time_pct` (dossier `ata ≤ eta` rate; NULL-safe via a new
   `num()` helper that preserves SQL NULL). FE `features/dashboard.tsx` now feeds the Control Tower's
   three decorative KPI cards (revenue / SLA / fleet) from these via the iframe injection script and
   **hides any card whose metric is null**. The 4th card (receivables "overdue") has no aggregate → stays
   mock. Clicking a card still opens the mock's sample detail modal (not rewired).

2. **Refresh-token rotation + reuse-detection (BE).** `app_user.service.refresh()` mints a fresh refresh
   token (new jti + sliding exp) bound to the SAME session, returns it as `refresh_token` (FE already
   captures it in `lib/api-client.ts`), and **stores its jti on the session** (`user_session.refresh_jti`,
   migration `0453_session_refresh_jti.sql`). On refresh the presented token's jti must match the session's
   current one; a mismatch = a rotated-away/replayed token → the session is **revoked** (reuse-detection).
   Legacy sessions (NULL `refresh_jti`) are grandfathered until their next refresh stamps one. `issueSession
   Tokens` stamps the jti on login/2FA/pin.

3. **Campaign templates + senders + send (BE+FE).** Migration `0452_campaign_templates.sql`
   (`campaign_sender` + `campaign_template`). Extended `sales/marketing_campaign` (MOD-22) with
   `/campaigns/senders` (+ `/:id/verify`), `/campaigns/templates` CRUD, and **`POST /campaigns/:id/send`**
   (all **registered before `/:id`**). Send renders a template to every active subscriber and enqueues one
   durable "email" job per recipient (delivered by `jobs/handlers/email-send.js`), with the template's
   sender as the `from` override. FE: `TemplateForm` moved off the `/settings/campaign_template` stopgap to
   the new endpoints + a **sender picker** with inline `SenderForm`; a **Send…** button on each campaign
   card opens `SendCampaignModal` (template picker → "Queued to N subscribers"). No per-recipient merge yet.
   Details in `doc/CAMPAIGN_TEMPLATES_BE_HANDOFF.md`.

**Postman + docs.** Added collection folder **13 · Marketing / Campaigns** (subscribers → sender → verify
→ template → send → cleanup, capturing ids) and made **`POST /auth/refresh`** capture the rotated
`refresh_token` (so a stale token now 401s — reuse-detection is testable in-collection). Updated
`doc/WORK_DONE.md`, `doc/FE_IA_BUILD_MAP.md` (statuses corrected — incl. the already-built Master data
hub), and `doc/CAMPAIGN_TEMPLATES_BE_HANDOFF.md`.

**Windows validation still required:** `npm run lint`, `npm test`, `npm run build --prefix client`, and
**apply migrations 0452 + 0453** to each tenant DB. Then smoke-test the Control Tower cards, the campaign
templates/senders tab + a send, a refresh cycle (incl. that an old refresh token is rejected after one
refresh), the vault trio, Smart Comms (needs the `comms` flag on), and My Workspace.

## Session log — 2026-07-17 (session 7: cross-cutting FE feature pass)

A directed batch across the FE (and a few BE list repos). **All in-sandbox `tsc --noEmit -p client`
clean; BE edits `node --check` clean. Windows `npm run lint` + `npm run build --prefix client` +
`npm test` remain authoritative, and the Control Tower iframe + every new form need a visual pass
(`npm run dev`).**

1. **Access/refresh token rotation (FE).** The BE `/auth/refresh` returns only a new `access_token`
   today (no rotation). Made the FE forward-compatible: it now stores a rotated `refresh_token` if the
   refresh response ever includes one — on both the boot path (`app/auth/auth-context.tsx`) and the
   401-retry path (`lib/api-client.ts`, incl. `{data:…}` unwrap). No-op until the BE rotates.

2. **QuickPIN — DONE (2026-07-18).** FE fully wired to the live `/auth/pin/*` routes (`auth-context`
   `pinLogin`/`registerPin`, `lib/pin-store.ts`, login-modal Quick PIN tab); BE `user_device`
   migration has landed in the identity/live schema. QuickPIN is live — no further FE or BE work.

3. **Removed all `MOD-` from the FE** (21 files). Guarded cleanup: parenthetical mentions `(MOD-xx)` and
   standalone tokens stripped, but the functional quoted keys `module: "MOD-XX"` in
   `scaffold/screen-specs.ts` were preserved (they gate RBAC), and BE `MODULE="MOD-XX"` keys were left
   untouched. NB a first, too-aggressive script pass corrupted code (removed empty `()` on non-MOD
   lines) — `tsc` caught it; reverted via `git show HEAD:<f> > <f>` (the mount blocks `unlink`, so
   `git checkout` fails) and redid it safely.

4. **Search everywhere (BE `q` + shared FE component).** Added `?q=` ILIKE to the registry repos that
   lacked it: `master/corporate_entity` (code/legal_name), `sales/lead` (company_name/contact_name),
   `sales/opportunity` (name), `operations/operations_file` (dossier `ref`), `finance/final_invoice`
   (`doc_number`), `master/financial_dictionary` (code/label_fr/label_en), `security/app_user`
   (full_name/email; threaded through `listUsersSafe`). `client_master` + `supplier_master` already had
   it. New shared **`SearchSelect`** in `features/sales/ui.tsx` — debounced `?q=`, client-side narrowing
   as a safety net for endpoints that ignore `q`, optional free-text commit, and an inline **"Add …"**
   action on an empty result. Wired: lead-capture **Company** (`features/sales/pages.tsx`, searches
   `/clients`, free-text prospect allowed) and quotation **Client** (`features/commercial/pages.tsx`,
   id+label). **Remaining pickers — DONE (2026-07-18):** converted meeting lead/client + opportunity
   client + proposal entity/client (`features/sales/pages.tsx`), quotation entity + pricing-variance
   dossier/quotation (`features/commercial/pages.tsx`, dropping the old `EntityOptions` helper for
   `entityText`/`entityLabelOf`), credit-note entity/client/reversed-invoice (`features/finance/pages.tsx`),
   bank-account entity (`features/settings/config-pages.tsx`) and portal client-scope
   (`features/portal/pages.tsx`). `SearchSelect` gained an optional **`filter?: (row) => boolean`** prop
   (used to keep the credit-note reversed-invoice picker scoped to FINAL invoices). **No assignee/user
   picker `<Select>` exists in the built screens** (`assigned_to` is display-only in wms), so that item
   was a no-op. In-sandbox `tsc --noEmit -p client` clean; Windows build authoritative.

5. **Quotations — dictionary line items + tax-code picker** (`features/commercial/pages.tsx`
   `QuotationForm`). Each line's description is a `SearchSelect` over `/financial-dictionary` (selecting
   an item fills label + default price + `is_debours` and sets `dictionary_item_id`); free text still
   allowed. Added a per-line **tax-code `<Select>`** (disabled on débours) sourced from
   `listSalesTaxCodes()` (new in `lib/masterdata-api.ts` — aggregates VAT codes across
   `/tax-jurisdictions/:id/codes` since there's no flat endpoint). Lines now submit `dictionary_item_id`
   + `tax_code_id` (both already accepted by the BE quotation validator), so `total_ttc != total_ht`.

6. **Reports — Dashboard tiles tab** (`features/vault/pages.tsx` `ReportsPage`). New "Dashboard tiles"
   segment reads `GET /reports/tiles`, lists the catalogue with **Add tile / Show-Hide / position**
   controls, upserting via `PUT /reports/tiles` (`{tile_key,position,is_visible,config}`; tile_key ==
   report_key). Feeds the Control Tower tile store.

7. **Marketing campaigns — Templates tab** (`features/sales/pages.tsx` `CampaignsPage` + `TemplateForm`).
   Create/edit/delete reusable email templates, **each carrying its own sender name + address**, plus
   subject + body. `marketing_campaign` (MOD-22) has **no** template/sender endpoints, so these persist
   in the generic settings store: `GET/PUT/DELETE /settings/campaign_template/:key` with
   `{ value: {name,subject,from_name,from_address,body_html} }` (arbitrary sections are allowed). **Caveat:
   `/settings` is gated MOD-70**, so a pure marketing role can't manage them yet — full rationale + the
   proposed dedicated `/campaigns/templates` + `/campaigns/senders` + send endpoints are in
   **`doc/CAMPAIGN_TEMPLATES_BE_HANDOFF.md`** (new this session).

8. **Control Tower — Lovable look restored, on live data** (`features/dashboard.tsx`, rewritten). Session 6
   had replaced the mock with plain React tiles; per the user we reverted to the **Lovable mock**. Restored
   `client/src/features/dashboard-mock/{body.html,style.css,script.js}.txt` from
   `doc/reference/reference-mock-lovable/src/lib/dashboard`, and render them in an `<iframe srcDoc>` with:
   the mock's own chrome hidden (`.testban/.topbar/.botnav/.drawer`), an injected script that rewrites the
   **live-shipments list**, the "N active" pill, the hero subline and the Praxis briefing from
   `/dashboard/control-tower` + `/dashboard/kpis` (mapping `live_shipments` → the mock's dossier row shape),
   and **theme sync** (parent `.dark` class → iframe `data-theme`). Decorative KPI cards (revenue/SLA/fleet)
   keep the mock's sample values — no BE source for them yet. **Must be eyeballed in `npm run dev`.**

9. **Settings-tiles recheck.** The generic `/settings/:section/:key` store (`security/setting`,
   `setting.rules.js`) already validates sections `document_template` (name/status/body_html/css_vars),
   `custom_field` (array of field defs), `email_signature` (tenant brand template) and `integration_secret`,
   and allows arbitrary sections + `_policy`/`_tiers` list values. So the previously-"no BE" tiles (custom
   fields, document templates, policies, email signatures) are **now buildable** on this store — a good next
   batch (mind the MOD-70 gate). **BUILT (2026-07-18)** — new `client/src/features/settings/store-pages.tsx`
   with `DocumentTemplatesPage` (section `document_template`, key=doc type, name/status/body_html/optional
   css_vars JSON), `CustomFieldsPage` (section `custom_field`, key=entity type, repeatable field-def editor
   → array value), `EmailSignaturesPage` (section `email_signature`, single key `template`, tenant brand html)
   and `BusinessPoliciesPage` (section `policy`, key=slug, name/body_html). All list+modal on the config-pages
   primitives, MOD-70-gated with graceful error state. Routed in `app.tsx` (replaced the four `<Planned/>`
   slots: `settings/document-templates|custom-fields|email-signatures|business-policies`); settings-hub cards
   already pointed at these routes. In-sandbox `tsc --noEmit -p client` clean; Windows build authoritative.

10. **Pre-existing build break fixed.** The repo pull left an unused `import * as React` in
    `components/ui/skeleton.tsx` (fails `noUnusedLocals`); removed it so the client typechecks clean.

**New/edited this session.** FE: `lib/api-client.ts`, `app/auth/auth-context.tsx`, `features/sales/ui.tsx`
(SearchSelect), `features/sales/pages.tsx` (lead company + Campaigns Templates tab), `features/commercial/pages.tsx`
(quotation dictionary/tax/client), `features/vault/pages.tsx` (Reports tiles), `features/dashboard.tsx`
(rewrite) + restored `features/dashboard-mock/*`, `lib/masterdata-api.ts` (`listSalesTaxCodes`),
`components/ui/skeleton.tsx`, + the 21 MOD-cleanup files. BE: `q` in `corporate_entity`/`lead`/`opportunity`/
`operations_file`/`final_invoice`/`financial_dictionary` repos + `app_user` repo/service. New doc:
`doc/CAMPAIGN_TEMPLATES_BE_HANDOFF.md`.

## Session log — 2026-07-17 (session 6: Sales/CRM funnel — Leads + Meetings)

Confirmed the whole next lane is BE-unblocked, then agreed a funnel model with the user —
**marketing → leads + opportunities → sales** — and folded all 11 Commercial + Sales & CRM
screens into a build order (Phase A leads → B opportunities → C marketing → D commercial).
Started Phase A. Pixie design pulled from the user's screen recording (`Recording 2026-07-17`).

1. **BE confirmation (all merged).** Read `src/shared/http/module-loader.js` — it auto-discovers
   any `src/modules/<group>/<mod>/<mod>.routes.js` and mounts it. Verified all funnel modules are
   present with full 7-file structure + real routes: opportunity (MOD-24, `/opportunities`,
   board/stages/move/win/lose), report (MOD-63, `/reports`, **feature-gated `reporting`**), lead
   (MOD-20, `/leads`), inbound_intake (MOD-25, `/inbound`), compliance_flag (MOD-65,
   `/compliance`), portal (MOD-67, `/portals`; external client/investor/auditor views gated behind
   `portal.client|investor|audit`), plus meeting (MOD-21), marketing_campaign (MOD-22), proposal
   (MOD-23), success_story (MOD-26), quotation (MOD-27, **gated `commercial.quotation`**), the two
   simulators + pricing_variance. **Gates to remember:** Reports needs `reporting`; Quotations needs
   `commercial.quotation`; portal external views need their `portal.*` flags.

2. **Leads & intake — BUILT** (`client/src/features/sales/pages.tsx`, `LeadsPage`). Two-tab screen
   (segmented control): **Leads** and **Inbound intake**. Leads tab = Pixie *Clients*-tab layout
   (search + filter chips All/New/Contacted/Qualified/Converted/Lost + avatar list-rows) wired to
   `/leads`: capture/edit (`POST`/`PATCH`), advance (`POST /leads/:id/transition` → CONTACTED /
   QUALIFIED / LOST), and **Convert** (`POST /leads/:id/convert`, QUALIFIED only → client_master).
   Intake tab (nested segment) = **Enquiries** (`/inbound/enquiries`, **Triage** → `:id/triage`
   `{to_lead,close}`) + **Partnership requests** (`/inbound/partnerships`, **Review** → `:id/review`
   `{status}`). Gated AI panel. **Decision:** intake folded into Leads (not a standalone screen);
   `/sales/inbound-intake` now **redirects** to `/sales/leads?tab=intake` (deep-link kept in nav).

3. **Meetings — BUILT** (`MeetingsPage`). List of meetings (`/meetings`); **Schedule meeting**
   (`POST /meetings`, subject + optional lead/client picker + `scheduled_at`); click a row → detail
   modal loads `GET /meetings/:id` (notes) with **Add note** (`POST /meetings/:id/notes`,
   `{body,is_minutes}`). Gated AI panel (summarise minutes / draft follow-up).

4. **Wiring.** `app/app.tsx` — imported `LeadsPage`/`MeetingsPage`, replaced the two `<Planned/>`
   slots + added the intake redirect. `app/layout/app-shell.tsx` — nav relabelled "Leads" →
   "Leads & intake"; "Inbound intake" now deep-links `?tab=intake`.

5. **Design fidelity.** The Pixie mock is dark crimson; we take its *structure* (tabbed CRM,
   filter chips, avatar rows, segmented controls) but render through the app's `--primary` token set
   so it re-tints per tenant. New primitives (`Segmented`, `Chips`, `Avatar`, `Badge`) are local to
   `features/sales/pages.tsx` for now — promote to `components/ui` if reused by the ⭐ hubs.

**Verified:** in-sandbox `node_modules/.bin/tsc --noEmit -p tsconfig.json` → **0 errors** (mount
served full files this session). **Authoritative check still: `npm run build --prefix client` +
`npm run lint` on Windows.** New/edited: `features/sales/pages.tsx` (new), `app/app.tsx`,
`app/layout/app-shell.tsx`, `features/scaffold/screen-specs.ts`, `doc/FE_IA_BUILD_MAP.md`.

6. **Opportunities Kanban — BUILT (Phase B, session 6)** (`OpportunitiesPage` in
   `features/sales/pages.tsx`). Board + List views (segmented). **Board** = one column per
   `/opportunities/stages` (sorted); cards = OPEN opps from `/opportunities` grouped client-side by
   `pipeline_stage_id`; per-column value from `/opportunities/board`; a **forecast strip** (open
   value / weighted forecast Σ value×prob / open deals / win rate). **Drag-to-move** cards between
   columns → `POST /:id/move {pipeline_stage_id}` (a won/lost stage auto-settles server-side).
   Per-card **Win** (modal, optional `create_dossier` + entity picker → `POST /:id/win`), **Lose**
   (`POST /:id/lose`), **Edit** (`PATCH`, name/value/currency/probability only — BE locks settled +
   won't PATCH stage/links). **List** view has a stage-move `<select>`. New primitive `MetricTile`
   added locally. Route wired in `app.tsx`; gated AI panel. Design = Pixie *Pipeline* tab.
   Note: BE `board` returns only per-stage aggregates (no cards), which is why the board composes
   `/stages` + `/` (list) rather than rendering `/board` directly.

7. **Proposals — BUILT (Phase B tail, session 6)** (`ProposalsPage` in `features/sales/pages.tsx`).
   List + status filter chips + search; click a row → **detail modal** (`GET /:id`) showing narrative
   sections + a priced line table with total. Create/edit **draft** with repeatable narrative-section
   and line-item editors (`POST` / `PATCH` — PATCH replaces children, DRAFT-only per BE). Lifecycle
   via inline action panels: Submit (`→IN_REVIEW`), Send (`→SENT`, needs entity → numbers the doc),
   Back to draft, Reject (`→REJECTED`), **Accept** (`POST /:id/accept`, optional `create_quotation`
   + entity → spins a quotation from the lines). Transitions follow the BE rules
   (DRAFT→IN_REVIEW→SENT→ACCEPTED/REJECTED). Gated AI panel (Draft/tighten = assist). Route wired.

8. **Marketing campaigns — BUILT (Phase C, session 6)** (`CampaignsPage`). Tabs Campaigns |
   Subscribers. Campaigns tab = metric strip (Active/Draft/Ended/Subscribers) + campaign cards with
   lifecycle buttons (`POST /campaigns/:id/transition`; DRAFT→ACTIVE→PAUSED↔ACTIVE→ENDED per BE
   rules); New campaign (`POST /campaigns`, name/channel/dates). Subscribers tab = list of active
   newsletter subscribers + Add (`POST /campaigns/subscribers`) + Unsubscribe
   (`POST /campaigns/subscribers/unsubscribe`). Pixie *Sales campaigns* layout. Gated AI panel.
9. **Success stories — BUILT (Phase C, session 6)** (`SuccessStoriesPage`). Filter chips
   (All/Draft/Signed off/Published; status derived from `is_published`/`signed_off_by`) + case-study
   cards. Create/edit **draft** (`POST` / `PATCH` — PATCH locked once published, per BE). Lifecycle
   **Sign off** (`/:id/sign-off`) → **Publish** (`/:id/publish`, BE requires prior sign-off) →
   **Unpublish** (`/:id/unpublish`). Gated AI panel (Draft/polish = assist). Both routes wired.

**Phase C complete — the whole Sales & CRM funnel is now built** (Leads/intake, Meetings,
Opportunities, Proposals, Campaigns, Success stories). `features/sales/pages.tsx` is the single file
for all six (~2000 lines, like `finance/pages.tsx`).

10. **Shared UI extracted (session 6).** The reused primitives moved out of `features/sales/pages.tsx`
    into **`client/src/features/sales/ui.tsx`** (`Row`, `errMsg`, `cell`, `when`, `fmtMoney`, `useList`,
    `Badge`, `Segmented`, `Chips`, `Avatar`, `MetricTile` + the `BADGE` colour map, now incl.
    EXPIRED/GREEN/YELLOW/RED). Both `sales/pages.tsx` and the new `commercial/pages.tsx` import from it.
11. **Commercial group — BUILT (Phase D, session 6)** in **`client/src/features/commercial/pages.tsx`**
    (the FS colleague said he'll verify the finance-side correctness):
    - **Quotations** (`/commercial/quotations`, MOD-27) — ⚠️ **feature-gated `commercial.quotation`**;
      when off, the list 403s and the page shows an "enable it" empty state (heuristic on the error).
      List + chips; detail modal (line table + HT/TTC from the BE); create/edit draft with a line
      editor incl. a **débours** (pass-through, untaxed) flag; lifecycle DRAFT→SENT (needs entity →
      numbers the doc; sends directly if the quote already has an entity)→ACCEPTED (inline "convert to
      final-invoice draft")/REJECTED/EXPIRED. **No tax-code picker yet** → lines aren't VAT-flagged from
      the FE, so total_ttc == total_ht until a tax_code_id is set; add a tax-code picker when needed.
    - **Margin simulation** (MOD-27) + **Extra-charge simulation** (MOD-28) — saved-sim cards + a modal
      with a line/tier editor, a **Preview** button (`/preview`, computes without persisting) and
      **Save** (`POST /`). Extra-charge needs a tariff — the modal has a tier editor (overrides tenant
      settings `commercial.demurrage_tariff`).
    - **Pricing variance** (MOD-27) — Sales R/Y/G list (flag + quote only; **raw cost never leaves the
      finance boundary**) + flag chips; **Compute** modal (dossier picker from `/operations`, quotation
      picker, optional quoted-price/actual-cost) → `POST /compute`. Note the dossier picker reads
      `/operations` (colleague's module) — empty/403 if this user lacks that view.

12. **Non-funnel hubs — BUILT (session 6).**
    - **Reports** (`/vault/reports`, MOD-63) in **`client/src/features/vault/pages.tsx`** — ⚠️
      **feature-gated `reporting`** (whole `/reports` router; "enable it" empty state when off).
      Catalogue tab (10 report producers) → Run modal with optional params (from/to/as_of/period_code/
      dossier_id) → generic `ResultBlock` (array→table, else JSON) → Save. Saved tab (run via
      `/saved/:id/run`, delete). Scheduling already lives in Settings → Scheduled reports (session 4);
      dashboard-tile picker (`/reports/tiles`) deferred — that's the Control Tower live-data follow-on.
    - **Compliance flags** (`/vault/compliance-flags`, MOD-65) in the same `vault/pages.tsx` — Flags
      tab: **Run checks** (`POST /compliance/run`, shows the summary), severity chips + include-resolved
      toggle, flag rows with **Resolve** (`/:id/resolve`). Rules tab = the rule catalogue.
    - **Portal access** (`/portal/access`, MOD-67) in **`client/src/features/portal/pages.tsx`** —
      active-grant list + **Grant** (client/investor/auditor; CLIENT needs a client scope) + **Revoke**
      (`/access/:id/revoke`). **Preview** buttons GET the external views (`/portals/client|investor|
      auditor`) and render the scope; each is gated `portal.client|investor|audit` → graceful "enable
      it" state when off. External-user auth (magic link) is a separate BE surface, not this screen.

13. **Control Tower — now LIVE (session 6).** `client/src/features/dashboard.tsx` **replaced** the
    static Lovable `<iframe srcDoc>` mock with real React tiles reading **`GET /dashboard/kpis`**
    (flat guarded counts) + **`GET /dashboard/control-tower`** (`operation_files {active,open,in_progress}`,
    `approvals_awaiting`, `live_shipments[]` = open/in-progress dossiers with ref/status/route/vessel/
    ETA). MOD-00A, permission-gated, no feature flag. Hero strip (active op-files / approvals / open
    compliance flags / unposted journals) + a live-shipments table + op-file breakdown + registry
    counts, all `lux-card`/token-styled + a Refresh button + gated AI panel. The mock files
    (`features/dashboard-mock/*`) are now **unused** (safe to delete). Not fed from `/reports/tiles`
    (that's a per-user tile-layout store) — the dedicated dashboard aggregate is the right source.

**Session 6 lane COMPLETE — every screen in this stream's lane (master data, Sales & CRM funnel,
Commercial, vault Reports/Compliance, Portal) is built and typechecks clean, and the Control Tower is
on live data.** New files: `features/sales/{pages,ui}.tsx`, `features/commercial/pages.tsx`,
`features/vault/pages.tsx`, `features/portal/pages.tsx`; rewrote `features/dashboard.tsx`. **Left for
later (follow-ons):** a tax-code picker for Quotations (so VAT flags from the FE); dashboard-tile
picker in Reports; delete the now-unused `dashboard-mock/*`; platform/godmode console UI. Vault
Documents/Signatures/Verification have BE gaps (see build map).

**Vault BE surface — checked 2026-07-18** (all three modules exist and are mounted; none are as thin as
"gap" implied):
- **Documents — BUILT (2026-07-18).** `document_vault` (MOD-64, `/documents`, no feature flag). GET `/`
  (list), GET `/:id`, GET `/:id/download` (confidential, not the public `/media` mount), POST `/` (upload;
  `validator.create` = `{ data_url (base64, req), doc_type?, entity_ref?, file_context? ∈ OPS|OVH,
  folder_ref?, dossier_id? }`), DELETE `/:id` (archive). Shipped `DocumentsPage` in
  `features/vault/pages.tsx` (list + status filter/search, **upload** via base64 data-URL with 25 MB cap,
  **archive**, and an **authed binary download** — a raw `fetch` with the Bearer + `X-Praxis-Env` headers
  that opens the PDF blob in a tab, since the endpoint returns bytes not JSON; 409 → "not rendered yet").
  Routed at `vault/documents` (replaced `<Planned/>`). `tsc`-clean.
- **Signatures — BUILT (2026-07-18).** `document_signature` (MOD-64, `/signatures`, **feature `signatures`**).
  GET `/?entity_ref=<ref>` (list is **keyed by entity_ref** — no all-signatures list) + POST `/` (sign, needs
  **`approve`** perm; `validator.sign` = `{ entity_ref (req), signer_name?, method? ∈ DIGITAL|PHYSICAL,
  signature_ref? }`). Shipped `SignaturesPage`: look up a document by reference → its signatures list + an
  **Add signature** modal; graceful "signatures not enabled" state (via `isGated`) when the flag/RBAC blocks it.
- **Verification — BUILT (2026-07-18).** `document_verification` (MOD-66, `/document-verification`, no flag).
  GET `/scan` (PUBLIC) + GET `/verify` (gated), query `{ hash (req, ≥4 chars), doc_id? | entity_ref? }` →
  `{ verified, doc_id, entity_ref, doc_type, version_no, content_hash }`. Shipped `VerificationPage` — a
  lookup widget (Reference|Document-ID toggle + hash → green/red tamper verdict card). Not a CRUD list.
  **Vault trio all routed** (`vault/documents|signatures|verification` replaced their `<Planned/>`); `tsc`-clean.

## Session log — 2026-07-16 (session 5: master-data trio + global AI gate)

Division of labour set with the FS colleague: **colleague owns finance + operations**;
this session (and the run to Sunday) covers everything else — master data, sales/CRM,
vault, portal, settings. QuickPIN migration has landed (colleague), so QuickPIN is live —
smoke-test register/login when convenient.

1. **Global AI gate (NEW).** All AI affordances now route through one gate:
   `client/src/components/ai-actions.tsx` — `useAiEnabled()`, `<AiGate>`, and the shared
   self-gating `<AiActions actions={…}/>` panel. AI is a per-tenant switch
   (`ai.assistant.backend` feature flag, flipped from the developer dashboard); when off,
   **no AI UI appears in any module**. The gate reads `user.ai_enabled` off the auth
   session (`app/auth/auth-context.tsx` `User` extended) and **defaults OFF** until the BE
   sends it (fail-safe — AI is opt-in). `screen-scaffold.tsx` was refactored to render its
   AI panel via `<AiActions>` (so all 47 scaffolds gate automatically).
   **BE side — DONE (2026-07-16, this session):** `ai_enabled` now ships on the login / 2FA /
   pin-login `user` payload. New `governance.isFeatureEnabled(client, key)` (tenant-level flag,
   ignores per-user grant/budget); `app_user issueSessionTokens()` resolves
   `ai_enabled = isFeatureEnabled(client, "ai.assistant.backend")` via a fail-safe
   `resolveAiEnabled()` (never throws → defaults false, can't block sign-in). Full notes in
   `doc/AI_GATE_BE_HANDOFF.md`. Toggling in the dev dashboard takes effect on next login.
2. **Master-data trio wired to live BE** — new `client/src/features/master/pages.tsx`
   (same primitives as `settings/master-data-pages.tsx`):
   - **Clients** `/master/clients` (MOD-03 `/clients`): list + create/edit (entity picker,
     NIU/RCCM, payment terms, credit limit, withholding, active) + a **Credit** modal
     (`GET /clients/:id/credit` → KYC/limit/used/available/within). Gated AI panel.
   - **Suppliers** `/master/suppliers` (MOD-04 `/suppliers`): list + create/edit (category,
     rating, payment method incl. conditional mobile-money fields, non-resident, active).
     Gated AI panel.
   - **Corporate entities** `/master/corporate-entities` (MOD-01 `/entities`): list +
     create/edit (code immutable on edit, legal name, NIU/RCCM, ISO-2 country, doc prefix,
     language, FY start month) + **Activate/Deactivate** (`POST /entities/:id/active`).
   Routed in `app.tsx` (replaced the three `<Planned/>` slots); nav already listed all
   three; `screen-registry.json` left as-is (not load-bearing for built pages — currencies/
   tax-jurisdictions have no entries either).
3. **Design fidelity:** the Lovable reference mock is dashboard-only (no per-entity Pixie
   layouts exist), so per the agreed fallback these three reuse the existing table+modal
   pattern. Pixie layouts to be pulled for the ⭐ hub screens next (Opportunities board,
   Reports, Portal access).

**Not yet Windows-verified** (batch workflow — sandbox mount unreliable for fresh files;
did not run in-sandbox `tsc`). **Authoritative check: `npm run build --prefix client` +
`npm run lint` + `npm test` on Windows.** New/edited FE files:
`components/ai-actions.tsx` (new), `features/master/pages.tsx` (new),
`app/auth/auth-context.tsx` (User type), `features/scaffold/screen-scaffold.tsx` (AI panel
→ `<AiActions>`), `app/app.tsx` (imports + 3 routes). New doc: `doc/AI_GATE_BE_HANDOFF.md`.

**Next in my lane (to Sunday):** ⭐ Opportunities Kanban (`/sales/opportunities`, MOD-24),
⭐ Reports runner (`/vault/reports`, MOD-63), ⭐ Portal access (`/portal/access`),
Leads + intake (MOD-20/25), Compliance flags (MOD-65). Pull Pixie layouts for the ⭐ ones.

## Session log — 2026-07-13 (FE)

1. **Landing → login flow** replicated from a screen recording ("The Pixie Hub" concept).
   Decisions taken with the user: data-driven white-label (Pixie is sample data);
   token-driven crimson via `--primary`; keep 2FA; wire keep-me-signed-in; Quick PIN as a
   UI stub; hero assets/copy authored on the Appearance screen. Files: `landing-page.tsx`,
   `login-modal.tsx`, `branding.ts`, `appearance-page.tsx`, `token-store.ts`,
   `auth-context.tsx`, `icons.tsx`, `index.css`, `app.tsx` route.
2. **Control-panel nav moved to the top bar** (Lovable pattern): Control Tower / Finance /
   Warehouse / Fleet inline (areas open dropdowns), **More** opens a full-menu collapsible
   overlay sidebar; left rail removed. File: `app-shell.tsx` (+ `index.css`).

`tsc --noEmit` on `client/` passes clean for both pieces.

## Session log — 2026-07-14 (FE + backend integration)

Backend was **pulled mid-session**; the colleague's Settings, IAM/security, MFA and QuickPIN
work is now in the repo (same `/api/tenant` contract — NOT the `/api/v1` Pixie doc, which is a
separate app's reference in `doc/SECURITY_BUSINESS_SETTINGS_IMPLEMENTATION.md`).

1. **IA / navigation map.** `app-shell.tsx` `NAV` expanded 7 → 15 groups across the whole
   `src/modules` map (Commercial, Sales & CRM, Operations, Procurement, Costing, Master data,
   Vault, Comms, + Settings & Admin). Unbuilt screens route to a shared `ComingSoon`
   (`client/src/features/placeholder/coming-soon.tsx`). Tab-vs-standalone plan + backend gaps in
   `doc/FE_IA_HANDOFF.md`; design tokens/classes in `doc/FE_DESIGN_RULES.md`.
2. **⌘K command palette** (`client/src/components/command-palette.tsx`) — filters all NAV
   screens; replaces the "search opens sidebar" stopgap. **More** still opens the full sidebar.
3. **Top-bar area menus open on hover** (180 ms grace close) + click/tap/keyboard. Fixed the
   transparent-dropdown bug: dropdown has an explicit `--popover` fill and the header is
   `relative z-40` (backdrop-filter stacking context was trapping it behind content).
4. **Settings hub** (`client/src/features/settings/settings-hub.tsx`) — pixie card grid
   (Identity / Money / Operations / Communication / Integrations & Security). `/settings` renders
   it (old key/value `SettingsPage` retired). "Businesses (list & provision)" tile removed per BE.
5. **Appearance + Login editors wired to the REAL branding backend** (the pull extended
   `branding.service.js`). `client/src/lib/branding.ts` now matches `GET/PUT /branding` (full
   token set: name, primary, primaryForeground, secondary, accent, accentDeep, accentGlow,
   info/success/warn/danger, logoUrl/logoAltUrl/faviconUrl, fontDisplay/Body/Mono, radius, theme)
   and adds `LoginConfig` + `fetchLogin`/`saveLogin`/`uploadLoginBackground` for
   `GET/PUT /branding/login` (backgroundUrl, headline, subtext, layout, showLogo, accentOverride).
   `appearance-page.tsx` + `login-editor.tsx` rebuilt against these — **all fields persist**.
   Shared controls in `components/settings/controls.tsx` (ImageField takes a custom `upload`).
   Speculative pixie-only fields (quotes/pillars/regionals/per-mode token bag/businesses/tagline)
   dropped — no backend.
6. **QuickPIN + MFA wired** to the colleague's auth routes (`/auth/pin/*`, `/auth/2fa/*`):
   `lib/pin-store.ts` (device registry, survives logout), `lib/security-api.ts`, self-service
   `features/security/my-security.tsx` (route `/security/my-security`, in the Security & Access
   menu), and the login modal's Quick PIN tab is now real. `auth-context.tsx` gained `pinLogin`
   + `registerPin`. **QuickPIN currently errors — missing `user_device` table (see gaps).**

**Not verified in-sandbox:** the sandbox degraded then died this session ("Failed to create
bridge sockets"), so no in-sandbox `tsc`. Files are correct on disk. **Run
`npm run build --prefix client` on Windows to confirm the FE typechecks.**

## Session log — 2026-07-14 (session 2 — pure-FE backlog cleared)

BE was **not touched** this session — all BE-blocked items (below) were parked pending the BE
dev's answers. Everything here is FE-only. `tsc -b --force` passed clean for the theme/landing
batch; the shell/CSS batch is verified by inspection but the sandbox mount cache wedged on
`app-shell.tsx` mid-session (see **Sandbox gotcha**), so confirm it with a Windows
`npm run build --prefix client`.

1. **Build fix.** Removed the unused `Input` import in `features/settings/login-editor.tsx`
   (the one `tsc` error blocking the build).
2. **Login screen now shows saved config (resolved a listed gap).** `features/landing/landing-page.tsx`
   fetches `GET /branding/login` via `fetchLogin()` and renders `headline` / `subtext` /
   `backgroundUrl` / `showLogo` / `accentOverride` / `layout`. Precedence: **saved login config →
   legacy `branding.hero` → generic copy** (hero still supplies eyebrow/body/pills, which
   `LoginConfig` doesn't carry). `accentOverride` is applied as a scoped inline `--primary` on the
   `.landing` container, so it re-tints the whole hero + login modal subtree.
3. **Login layout field is real.** `index.css` gained `.landing[data-layout="centered"]` rules;
   default / `"split"` keeps the current left-aligned hero.
4. **Full theme token set applies live (resolved a listed gap).** `lib/theme.ts` `applyBrand()`
   now sets, beyond primary: `--secondary`, `--accent`, `--brand-orange` + `--brand-orange-deep`
   (from primary / accentDeep), `--destructive` + status-pill triplets `--ok`/`--warn`/`--bad`
   (from success/warn/danger), `--info`, fonts (`--font-display/-body/-mono`) and `--radius`.
   Hex → `"R G B"` triplet conversion is done for the pill tokens (they're consumed as
   `rgb(var(--x) / a)`); non-hex values are skipped rather than written invalid. `resetBrand()`
   reverts the whole managed set. `app/branding/branding-context.tsx` `paint()` now threads the
   full token set (was primary + foreground only), so it applies on the public fetch and on save.
5. **Mobile bottom nav (Lovable pattern).** `app/layout/app-shell.tsx` gained a `BottomNav`
   (Control Tower / Files / Finance / Search), **mobile-only** (`flex md:hidden`), active-by-route-
   prefix, Search opens the ⌘K palette. Full 15-group menu still reached via the top-bar hamburger,
   exactly as in the mock. `<main>` padded `pb-24 md:pb-6` to clear the bar. Styles: `.lux-botnav` /
   `.lux-botnav-btn` in `index.css` (active tint follows `--primary`, so it re-tints per tenant).
   Note: display is driven by the `flex md:hidden` utilities, **not** by the class (a `display` in
   `.lux-botnav` would beat `md:hidden` on source order).
6. **Cleanup.** Deleted the stray `client/src/_wtest.txt`.

## Session log — 2026-07-15 (test fix + BE answers + Finance write forms)

1. **Test-isolation fix.** `tests/jest.setup.js` now blanks external-provider vars
   (`GROQ_API_KEY`, `GEMINI_API_KEY`, `SMTP_HOST`, etc.) so the local `.env` no longer leaks
   placeholder keys into unit tests. Fixed the 3 failing `services/ai/*` + email guard tests.
   Windows lint + client build pass; `npm test` green. Test-only change.
2. **BE answered the 4 open questions** (see below): identity pins to the live schema; QuickPIN
   migration + remaining Settings endpoints + Finance write endpoints are all available.
3. **Finance write forms built** (against the verified BE contracts):
   - **Tax Center → Declarations / filing tab** (`features/finance/pages.tsx` `DeclarationsPanel`
     + `FileDeclarationForm`/`SubmitDeclarationForm`): list declarations, **File a return** (kind
     ∈ TVA/IS/MIN_TAX/WHT/DSF/CNPS/DIPE/PATENTE, period_code, entity, from/to/due_on) →
     `POST /tax/declarations`; per-row **Approve** (`/approve`) and **Submit** (`/submit` with
     `filed_ref`). Status pill DRAFT→COMPUTED→APPROVED→FILED.
   - **Credit notes** (`CreditNotesPage`, route `/finance/credit-notes`): create (entity, client,
     reverses a FINAL invoice, lines with required `label`) → edit draft → **Post** (`/post`).
   - Helpers added to `lib/finance-api.ts` (tax: `listDeclarations`/`fileDeclaration`/`approve`/
     `submit`; CN: `list/get/create/update/post` + `loadFinalInvoices`). Wired in `app.tsx`, nav
     (`app-shell.tsx`), and `screen-registry.json` (`fin_credit_notes`).
   - **In-sandbox `tsc --noEmit` on `client/` passed clean** (mount served full 2103-line
     `pages.tsx`, not truncated). Confirm with a Windows `npm run build --prefix client`.

## Session log — 2026-07-15 (part 2: identity pinned to the live schema)

Implemented the answer to open question #1 — the LIVE/TEST toggle no longer logs the user out.

1. **New `req.identityDb` (always live schema)** in `middleware/tenant-context.js`, alongside the
   existing env-bound `req.tenantDb`. Both call `registry.withTenantConnection`; identityDb forces
   `env="live"`.
2. **Enforcement path pinned:** `middleware/auth.js` (`getAuthUser`) and `middleware/rbac.js`
   (`getGrants` / `getUserScopeIds` / `getUserCapabilities`) now resolve via `req.identityDb`.
3. **Auth/session/identity controllers pinned:** all of `security/app_user` (login, refresh,
   logout, verifyTotp, setup/enable/disable TOTP, pin register/login/list/revoke, user CRUD),
   `security/session` (mine/kill/killAllMine + base CRUD).
4. **RBAC-admin writes pinned** so grants edited = grants enforced: `permission` (`upsertGrant`
   + base), `iam_role`, `capability`, `scope`, `field_visibility`. Enabled by a new
   `makeController(service, label, { identity: true })` option in `shared/crud/resource.js`
   (defaults false → every business module is unchanged).
5. **Auth services untouched** — they already take a `client`; only the caller picks the schema.
6. **Verified in-sandbox:** `node --check` + `eslint` clean on all 11 changed files. **Windows
   `npm run lint` + `npm test` still required** (sandbox can't run the DB integration tests).
7. **Field-mask coherence — also fixed.** `shared/rbac/field-mask.js` gained
   `maskForUserVia(req.identityDb, user, data)`; `employees` + `operations_file` controllers read
   data on the env client but resolve masked field_keys from the identity schema, so confidential
   fields stay masked under TEST. Remaining flagged items (a BE call, not done): `audit_ledger`
   identity-vs-env, and the `portal` session model.

## Session log — 2026-07-15 (part 3: LIVE/TEST toggle polish)

Now that identity is env-independent, the toggle became a real in-app control. `app/layout/app-shell.tsx`:

1. **Soft switch (no reload).** `env` is React state (was a one-shot `tokenStore.getEnv()`).
   `switchEnv(next)` persists `X-Praxis-Env` and updates state; **`key={env}` on `<main>`**
   remounts the routed screen so every `useEffect` re-fetches under the new env. Access token +
   auth survive (no more `window.location.reload()`, no logout). `toggleEnv` removed.
2. **Segmented Live | Test control** replaces the single status pill (emerald LIVE / amber TEST,
   `aria-pressed`).
3. **TEST-MODE banner** (Lovable mock): amber bar under the header when `env==="sandbox"`
   ("you're viewing sandbox data… Switch to live").

**Sandbox gotcha recurred (again on `app-shell.tsx`):** after these edits the bash mount served a
**truncated 606-line copy** (`wc -l`=606) while the real file is 646 lines and well-formed (verified
via the file-tool Read, end to end). In-sandbox `tsc` therefore reports bogus JSX errors at
lines 532/607 against the stale snapshot. **Do NOT `cat`/`sed` it back** (would persist the
truncation). The file on disk is correct — **confirm with a Windows `npm run build --prefix client`.**

## Session log — 2026-07-15 (part 4: audit_ledger split + portal cleared)

Closed the two residual identity-coherence items from part 2.

1. **audit_ledger split** (`security/audit_ledger/audit_ledger.controller.js`): access reviews +
   security-events reads now use `req.identityDb` (they read `app_user`/`user_role` and the
   `event_log` rows that auth+RBAC now write to live); soft-delete restore + base CRUD stay on
   `req.tenantDb` (per-env business records). node/eslint blocked by the wedged mount — Windows
   `npm test` authoritative.
2. **portal**: investigated, **no change** — it manages `portal_access` (business, per-env) and
   issues no `app_user` sessions, so it doesn't share the identity model.

## Session log — 2026-07-15 (part 5: Settings tiles — currencies + tax rates)

1. **New `client/src/features/settings/master-data-pages.tsx`** — `CurrenciesPage` (currencies
   list + FX rates table + "Set rate" modal → `POST /currencies/rates`) and `TaxJurisdictionsPage`
   (jurisdictions list + "New jurisdiction" + activate/deactivate + expandable per-jurisdiction
   **tax codes** panel with "Add code" → `POST /tax-jurisdictions/:id/codes`). Same primitives as
   the finance pages (Modal/Field/Select/Table/states).
2. **Routed** at `master/currencies` + `master/tax-jurisdictions` in `app.tsx` (were `ComingSoon`);
   nav + screen-registry entries already existed.
3. **Remaining tiles mapped** — see Open question #3 below (numbering/signatures/catalogue/treasury
   are available; six others have no BE endpoint yet).
4. **Verification:** the new file typechecks clean against itself in-sandbox (540 lines, full); the
   only `tsc` errors are the **wedged-mount truncation artifacts** on the edited `app.tsx` +
   `app-shell.tsx` (both verified complete on disk via the file tool). **Windows
   `npm run build --prefix client` is the authoritative check for this session's FE.**

## Session log — 2026-07-15 (session 4: Settings tiles + per-tenant PWA + screen scaffolds)

**Not yet Windows-verified** (sandbox mount corruption recurred on the heavily-edited `app.tsx`
— in-sandbox `tsc` reports a bogus `(208,x) TS1127 Invalid character`; the real file is clean at
207 lines via the file tool). **Authoritative check: `npm run build --prefix client` + `npm run
lint` + `npm test` on Windows.** Backend `node --check` + `eslint` are clean on the new server
files.

1. **Settings tiles built** — new `client/src/features/settings/config-pages.tsx` (same primitives
   as `master-data-pages.tsx`): **Bank accounts** (`/treasury-accounts`, entity picker from
   `/entities`), **Payment gateways** (`/payment-gateways`, credentials write-only),
   **Scheduled reports** (`/reports/scheduled` + `/reports/catalogue`), **API keys & secrets**
   (`/ai/governance/vendors` + `/:vendor/test`), **Pipeline stages** (`/opportunities/stages`,
   read-only — no stage CRUD in BE), **Document numbering** (`/numbering-schemes/:moduleKey` +
   `/catalogue/modules`). Routed in `app.tsx` (replaced the `ComingSoon` slots), `screen-registry.json`
   entries added. Settings-hub cards already pointed here.
2. **Per-tenant PWA** — `src/routes/pwa.js` serves **`GET /manifest.webmanifest`** (name/short_name/
   theme_color from branding, Host-resolved) and **`/icons/app-icon-{192,512}.png`** + a maskable
   variant (tenant logo via sharp `fit:contain`, else a brand-coloured monogram; never throws;
   in-process + `Cache-Control` cache). Mounted in `server.js` **before** the SPA catch-all.
   `vite.config.ts` → `VitePWA({ manifest:false, registerType:'autoUpdate', workbox:{…} })` + dev
   proxies for `/manifest.webmanifest` and `/icons`; `index.html` adds the manifest link +
   apple-touch-icon. Subdomain-per-tenant = one origin per tenant, so manifest/SW/install are
   naturally per-tenant. `sharp@0.33.5` + `vite-plugin-pwa@0.20.5` were already in the deps.
   **Verify with Lighthouse + a real install on two tenant subdomains.**
3. **Screen scaffolds (all 47 un-built screens)** — `client/src/features/scaffold/screen-scaffold.tsx`
   (the `ScreenScaffold` + `<Planned/>` wrapper) renders a finished skeleton: area/title, a
   **BE-status badge** (ready/partial/readonly/none), primary action buttons, **tabs**, the planned
   **table columns** with an "awaiting backend integration" state, and an **AI-actions** panel.
   The catalogue is `client/src/features/scaffold/screen-specs.ts` (47 typed specs; also the source
   for the doc). `app.tsx` now points every un-built route at `<Planned/>` (was `ComingSoon`).
   `features/placeholder/coming-soon.tsx` is now **unused** (safe to delete; only referenced in
   comments).
4. **New doc `doc/FE_IA_BUILD_MAP.md`** — the work-to-be-done map (screens/pages/tabs/columns/
   actions grouped by area, for design/Pixie inspiration) **plus the AI-integration map** (every
   screen/tab where the AI model can be invoked; `assist` = genuine LLM step). Central assistant:
   `POST /api/tenant/ai/ask` (+ `/actions/:id/confirm`), feature `ai.assistant.backend`; every
   module registers `reads`+`writes` tools via `<module>.ai.js`.
5. **Correction to a prior note:** `finance/debt` is **not** partial — it's full CRUD at basePath
   **`/financing`** (GET/POST/PATCH/DELETE + `/:id/drawdown` + `/:id/repay`, MOD-53). Marked
   **ready** in the specs + build map.

## Recommended next screens (BE endpoints verified — hand to Pixie for design inspo)

All **ready** (endpoints confirmed by reading each `*.routes.js`); build by wiring, following
`config-pages.tsx` / `master-data-pages.tsx`. Route = FE path; BE = API basePath under
`/api/tenant`. ⭐ = strong Pixie-inspo candidate (distinctive layout).

| Screen | FE route | BE endpoints (module) | Notes |
|---|---|---|---|
| **Clients** | `/master/clients` | `GET/POST /clients`, `PATCH /clients/:id`, `GET /clients/:id/credit` (MOD-03) | Master registry; referenced everywhere. Easy first win. |
| **Suppliers** | `/master/suppliers` | `GET/POST /suppliers`, `PATCH /suppliers/:id` (MOD-04) | Twin of Clients. |
| **Corporate entities** | `/master/corporate-entities` | `GET/POST /entities`, `PATCH /entities/:id`, `POST /entities/:id/active` (MOD-01) | Unlocks Business setup; already consumed by Bank accounts. |
| ⭐ **Operations files (dossiers)** | `/operations/files` | `GET/POST /operations`, `PATCH /operations/:id`, `POST /operations/:id/transition`, `GET /operations/:id/360` (MOD-29) + milestones `/milestones/dossier/:id`,`/instantiate`,`/:id/advance` (MOD-31) + `/transit-orders` (MOD-30) + `/delivery-notes` (MOD-32) | The operational hub — a tabbed dossier workspace (360 view, milestones timeline, transit orders, delivery notes). Best single build. |
| ⭐ **Opportunities (pipeline)** | `/sales/opportunities` | `GET /opportunities/board\|stages`, `GET/POST /opportunities`, `PATCH /opportunities/:id`, `POST /opportunities/:id/move\|win\|lose` (MOD-24) | **Kanban board** with drag-to-move + weighted-value forecast. High-visual Pixie candidate. |
| **Leads + inbound intake** | `/sales/leads` | leads `GET/POST /leads`,`PATCH /leads/:id`,`POST /leads/:id/transition\|convert` (MOD-20); intake `/inbound/enquiries\|partnerships` + `/enquiries/:id/triage` (MOD-25) | Funnel top; AI **triage** assist. |
| ⭐ **Supplier invoices (AP + 3-way match)** | `/procurement/supplier-invoices` | `GET/POST /supplier-invoices`, `POST /supplier-invoices/:id/match`, `POST /supplier-invoices/:id/post` (MOD-61) | Invoices tab + a **three-way-match** panel (PR↔PO↔GRN↔invoice); AI-assist match. |
| **Cash requests + Régie** | `/costing/cash-requests`, `/costing/regie` | cash `/cash-requests` (+`/:id/transition\|disburse\|justify`, MOD-49); régie `/regie` (+`/issue`,`/age-due`) | Disbursement + advance lifecycle. |
| **Financing & debt** | `/finance/debt` | `GET/POST /financing`, `PATCH/DELETE /financing/:id`, `POST /financing/:id/drawdown\|repay` (MOD-53) | Full CRUD (corrected). Loan register + drawdown/repay. |
| ⭐ **Reports** | `/vault/reports` | `GET /reports/catalogue`, `GET /reports/run/:key`, `GET/POST /reports/saved`, `GET/PUT /reports/tiles` (MOD-63) | Report runner + saved reports + dashboard-tile picker. Feeds the Control Tower. |
| **Compliance flags** | `/vault/compliance-flags` | `GET /compliance/catalogue`, `GET /compliance`, `POST /compliance/run`, `POST /compliance/:id/resolve` (MOD-65) | Rules catalogue + flag queue + resolve. |
| ⭐ **Portal access** | `/portal/access` | `GET/POST /portals/access`, `POST /portals/access/:id/revoke`, `GET /portals/client\|investor\|auditor` (portal) | Grant manager + external client/investor/auditor read views. |

**My pick order if I keep going:** (1) Clients + Suppliers + Corporate entities (fast, unblock
everything), (2) ⭐ Operations files (the hub), (3) ⭐ Opportunities board, (4) ⭐ Supplier invoices
(3-way match), (5) ⭐ Reports, (6) ⭐ Portal access. The ⭐ four are the ones worth pulling Pixie
layouts for; the master-data trio reuse the existing table+modal pattern as-is.

## Open questions — ANSWERED by BE dev (2026-07-15)

1. **Shared identity across LIVE/TEST? — RESOLVED: YES + IMPLEMENTED (2026-07-15).** Identity is
   now env-independent — see the session log "Identity pinned to the live schema" below. Auth,
   RBAC, sessions, devices, 2FA and user/role/permission admin all resolve against the live
   schema via a new `req.identityDb`; only *business* data honours `X-Praxis-Env`. Backend
   `node --check` + eslint clean in-sandbox; **run `npm run lint` + `npm test` on Windows to
   confirm.**
2. **`user_device` migration (QuickPIN) — DONE (2026-07-18).** Table (columns: `device_id,
   user_id, label, pin_hash, status, failed_pin, last_used_at, created_at`) has landed in the
   **live schema**; the pin register/login/list/revoke controllers resolve via `req.identityDb`
   (live) per #1. FE was already wired — QuickPIN is now live.
3. **Endpoints for the remaining Settings tiles — AVAILABLE (2026-07-15), partially verified.**
   Confirmed in `src/modules/master/`: **currencies** (`/currency`, incl. `POST /rates`
   setRate + convert/rate reads) and **tax rates** (`/tax_jurisdiction`, incl. `POST /:id/codes`,
   `/:id/effective`). **BUILT (2026-07-15):** both wired to live endpoints as `CurrenciesPage` +
   `TaxJurisdictionsPage` in `client/src/features/settings/master-data-pages.tsx`, routed at
   `master/currencies` and `master/tax-jurisdictions` (were `ComingSoon`).
   **Remaining tiles — endpoints VERIFIED (2026-07-15, read each `*.routes.js`):**
   - numbering → `/numbering-schemes` (security/numbering_setting) — AVAILABLE.
   - email signatures → app_user `GET/PUT /:id/signature` (per-user) — AVAILABLE.
   - document catalogue → `/catalogue` — AVAILABLE.
   - **bank accounts → `/treasury-accounts`** and **payment gateways → `/payment-gateways`** —
     BOTH in `master/treasury_account` (MOD-09; one routes file, basePath `/`, two sub-routers —
     that's why it didn't surface in the basePath sweep). Full CRUD; gateway credentials write-only.
   - **scheduled reports → `/reports/scheduled`** (vault/report MOD-63) — full CRUD (GET/POST/
     PATCH/DELETE + run-due). AVAILABLE.
   - **pipeline stages → `/opportunities/stages`** (+ `/board`, `/:id/move`) (sales/opportunity
     MOD-24) — AVAILABLE.
   - **api-keys / integration secrets → `/ai/governance/vendors`** (GET/PUT/test, MOD-70) — covers
     AI provider keys; if the tile means broader 3rd-party secrets, only AI vendors exist today.
   - **NO endpoint (notify BE):** **custom fields**; **document templates** (only *milestone*
     templates + smartcomm exist, not document/letterhead templates); **business policies** (maybe
     intended for the generic `/settings` key-value store — confirm with BE).
4. **Finance write endpoints — AVAILABLE + CONTRACTS VERIFIED (2026-07-15).** Dedicated modules
   now exist:
   - **Tax filing** `finance/tax_declaration` (MOD-07, basePath `/tax`): `POST /tax/declarations`
     (validator.file → DRAFT/COMPUTED), `POST /tax/declarations/:id/approve`,
     `POST /tax/declarations/:id/submit` (validator.submit → FILED), GET `/tax/declarations`(+`/:id`).
     The existing GET-only `/tax/*-return` compute endpoints are unchanged.
   - **Credit notes** `finance/credit_note` (MOD-51, basePath `/credit-notes`, feature
     `accounting.core`): `POST /credit-notes` (validator.create), `PATCH /credit-notes/:id`
     (validator.update), `POST /credit-notes/:id/post`, GET `/credit-notes`(+`/:id`).
   **FE DONE (2026-07-15):** Tax Center **Declarations / filing** tab + **Credit notes** screen
   (`/finance/credit-notes`) both wired to these endpoints. See the session log below.

## First thing to do in a new session

**Sessions 3 + 4 are fully Windows-verified** — `npm run lint`, `npm test`, and
`npm run build --prefix client` pass. **Session 5's FE (master-data trio + AI gate) was
Windows-verified by the user; the session-5 BE change (`ai_enabled`) was written after that
and is NOT yet verified.**

**⚠️ PC SWITCH (2026-07-16):** this handoff was written just before the user moved to another
machine. Pull latest, then start at step 0.

**Pick up here (priority order):**

000. **Session 10 — Windows chores + a visual pass.** Nothing here is `tsc`/`eslint`-dirty, but none of it
   has been through `npm run lint` / `npm test` / `npm run build --prefix client`. Do the deletions first,
   since `noUnusedLocals` will catch anything they orphan:
   ```powershell
   Remove-Item .git\index.lock -Force     # left by a git rm the sandbox mount blocked
   git rm client\vite.config.js client\vite.config.d.ts
   git rm client\src\features\master\pages.tsx
   npm run build --prefix client
   ```
   ⚠️ Deleting the two vite artifacts makes **`vite.config.ts` live config for the first time in a while**.
   I diffed them — equivalent apart from compiled syntax (`feature-${area}` vs `.concat`) — so the build
   should produce the same chunks. If it doesn't, that's the tell that something existed only in the `.js`.
   Then `npm run dev` and click: **`/security/permissions`** (the rebuilt matrix — dot colours, the cell
   popover, that the ceo row is locked, the module search), the **Control Tower** (every app tile, both
   hero buttons, a live-shipment row landing on `/operations/files?ref=…`, the greeting showing *your*
   name, the FAB opening the real palette, the map badge), **Fleet and Warehouse** tab by tab with the
   server log open (see session-10 log §3 — more never-executed SQL is plausible), and any screen mid-load
   for the new skeletons (throttle to Slow 3G if local is too fast to see them).
   **Also still true from session 9: `npm test` has never run the five campaign merge-field cases.**

00. **Session 9 needs Windows validation + a visual pass** — `npm run lint`, `npm test`, `npm run build
   --prefix client`. **`npm test` matters more than usual**: jest wouldn't run in the sandbox, so the five
   new merge-field cases in `tests/unit/campaign-send.test.js` have never executed. Then `npm run dev` and
   click: the Security and Vault hubs (all sections), the six new Security forms, **all four Control Tower
   KPI cards** incl. CTA routing and one card with a user lacking the grant (empty state), the **access
   review** flow end to end (most stateful thing built), notification **preferences** save round-trip, and
   the **restore queue** as the same user who deleted a record (maker-checker rejection should read as a
   clear error, not a mystery failure). Also worth doing: the two `git rm` deletions in the session-9
   dead-code note, then re-run the client build — `noUnusedLocals` will catch any import that only those
   blocks used.
0. **Session 7 needs Windows validation + a visual pass.** Session 7's FE is in-sandbox `tsc`-clean and
   the BE `q` edits are `node --check`-clean, but run `npm run lint` + `npm run build --prefix client` +
   `npm test` on Windows and **open `npm run dev`** to eyeball the rebuilt **Control Tower iframe** and the
   new forms (lead **Company** search, quotation **dictionary + tax-code** pickers, Reports **Dashboard
   tiles** tab, Campaigns **Templates** tab). Files in the session-7 log above. Session 6 (prior) was also
   `tsc`-clean — confirm both and commit.
0b. **Next in this lane (session 7 leftovers):** (a) **DONE (2026-07-18)** — remaining reference pickers
   converted to `SearchSelect` (meeting, opportunity, proposal, quotation entity, credit-note, bank-account,
   pricing-variance, portal; no assignee/user select existed). See session-7 log §4; `tsc`-clean.
   (b) **DONE (2026-07-18)** — the Settings tiles on the generic `/settings` store (document templates,
   custom fields, email signatures, policies) are built in `features/settings/store-pages.tsx` and routed;
   session-7 log §9. (c) **DONE (session 8)** — the endpoints proposed in
   `doc/CAMPAIGN_TEMPLATES_BE_HANDOFF.md` were built; that file is now a **record**, not a request.
   Nothing to hand over.
1. **Sales/CRM funnel — DONE (session 6).** Model: **marketing → leads + opportunities → sales**;
   build order in the session-6 log + `doc/FE_IA_BUILD_MAP.md` (Sales & CRM). All six shipped in
   `client/src/features/sales/pages.tsx`: Leads & intake (MOD-20 + folded MOD-25), Meetings (MOD-21),
   ⭐ Opportunities Kanban (MOD-24), Proposals (MOD-23), Marketing campaigns (MOD-22), Success stories
   (MOD-26). **Phase D — Commercial group also DONE (session 6):** Quotations (gated
   `commercial.quotation`), Margin + Extra-charge simulations, Pricing variance — in
   `client/src/features/commercial/pages.tsx` (FS colleague verifying finance correctness). Shared
   primitives now live in `client/src/features/sales/ui.tsx`. **Non-funnel hubs also DONE (session 6):**
   Reports (`/vault/reports`, MOD-63, gate `reporting`) + Compliance flags (`/vault/compliance-flags`,
   MOD-65) in `features/vault/pages.tsx`; Portal access (`/portal/access`, MOD-67) in
   `features/portal/pages.tsx`. **This stream's entire lane is now built.** Follow-ons (not lane work):
   Control Tower live tiles (`/reports/tiles`), a tax-code picker for Quotations, the Reports
   dashboard-tile picker, platform/godmode console. All BE modules confirmed merged (session 6).
2. **Settings tiles — DONE (session 4) + finding updated (session 7).** Bank accounts, payment gateways,
   scheduled reports, API keys, pipeline stages (read-only), numbering all built in `config-pages.tsx`.
   **DONE (2026-07-18):** document templates, custom fields, email signatures and policies are now built on
   the generic `/settings/:section/:key` store (`features/settings/store-pages.tsx`, routed; MOD-70-gated).
   Only genuinely BE-less tiles left: **factory languages** and **help center**.
3. **Per-tenant PWA — DONE (session 4)** (`src/routes/pwa.js` + `vite.config.ts` + `index.html`).
   **Polish DONE (2026-07-18):** `manifest.background_color` now follows the tenant theme mode
   (`src/routes/pwa.js` `resolveBranding` → light `#f3f6fb` / dark `#071324`, matching the app's
   `--background`), so the launch splash doesn't flash the wrong colour. Maskable icons were already
   served on-demand (`/icons/app-icon-maskable-512.png`, sharp render + cache) — no pre-gen needed.
   Left to do: **Lighthouse audit + a real install on two tenant subdomains** (manual/ops step, no code
   dependency). `node --check` clean; Windows lint/test authoritative.
4. **QuickPIN — DONE (2026-07-18).** The `user_device` migration has landed in the live schema;
   FE + controllers were already wired, so QuickPIN is live. Nothing left here.
5. **Control Tower — reverted to the Lovable mock, on live data (session 7).** `features/dashboard.tsx`
   renders the restored `features/dashboard-mock/*` in an `<iframe srcDoc>` and injects live
   `/dashboard/control-tower` + `/dashboard/kpis` (see session-7 log §8). **`dashboard-mock/*` is USED
   again — do NOT delete it.** Remaining: platform/godmode console UI; the decorative KPI cards
   (revenue/SLA/fleet) still show mock values (no BE source).

**⚠️ For the FS colleague — added 2026-07-20 (session 10):**

1. **`master/employees/employees.repo.js` selected `ce.name`, which has never existed** — the column is
   `corporate_entity.legal_name`. `get` and `list` both. That module is **not** feature-gated, so nothing
   was hiding it: **`/employees` has been 500ing since it was written and HR Employees has never worked.**
   Fixed here, but it's your screen — worth knowing rather than rediscovering.
2. **19 modules were dark for everyone, including the CEO** — `fleet`, `wms` and the HR extras among them,
   i.e. most of your lane. It was the feature gate, not RBAC (session-10 log §2). Fixed and re-projected;
   run `node scripts/tenant/feature-report.js --slug=<slug>` if a page 403s and you want to know which of
   the two layers is refusing.
3. **Your `e68a8df` added `<HubTabs/>` to the shared `components/resource-list.tsx`.** Fine as it stands,
   but it means *any* `ResourceList` rendered inside a `TabbedHub` now draws a tab bar. Master data is the
   only `inlineTabs` hub — if one of its tab pages ever moves to `ResourceList`, it'll render two bars.
4. **Fleet/WMS sub-screens dropped out of ⌘K** when the nav collapsed to one entry per area (the palette
   filters `NAV`). Security/Vault kept theirs, so the two lanes now behave differently — worth picking one.

**⚠️ For the FS colleague — read before starting anything (2026-07-19):**

1. **Governance is DONE — do not build the Audit ledger.** You reported "governance pages have been done,
   only pending is Audit ledger". That was true of the tree you can see, because **session 9 was
   uncommitted when you looked**. As of this branch all four governance screens are real: Audit ledger
   (`pages.tsx:255`, four segments), Notifications (`:510`, inbox + preferences), Workflows (`:736`) and
   Approvals (`:783`) — the last two are yours and untouched. Building Audit ledger now would collide head-on.
   (Small correction for the record: before session 9, **both** Audit *and* Notifications were
   `ResourceList` stubs, not just Audit.)
2. **Vault was already built** — all five pages shipped session 8. Your list had it as unbuilt; it only
   needed a hub, which session 9 added. **Security genuinely was stubs** and is now full CRUD.
3. **Your lane is fleet (7) + wms (6) + hr (10) — plus one you didn't name: `AssetsPage` in
   `features/finance/pages.tsx` is still a `ResourceList` stub** and `/finance/assets` routes straight at
   it, inside a file that otherwise looks finished.
4. **The pattern to copy** is `features/security/{pages,hub}.tsx` from this session, not the shared
   `TabbedHub` — see session-9 log §2 for why that component doesn't fit pages which don't render
   `<HubTabs/>`.
5. **Two dead files to `git rm`** (the sandbox mount blocks unlink): `features/master/pages.tsx` (748
   lines, zero importers) and the `ReceivablesPage`/`ChartOfAccountsPage` blocks in
   `features/finance/pages.tsx`. **Do not touch `features/dashboard-mock/`** — it's live.

**Notify the BE dev:** (a) ~~`doc/CAMPAIGN_TEMPLATES_BE_HANDOFF.md`~~ — **no longer a handoff.** The
proposed `/campaigns/templates` + `/campaigns/senders` + send endpoints (MOD-22) were built in session 8
and are live; that doc is now a record of what shipped. Do not rebuild them. Remaining gaps there are
per-recipient merge and real (SPF/DKIM) sender verification. (b) The session-7 `?q=` search filters were
added to `operations_file`/`final_invoice`/`app_user` (your modules) plus the master/sales repos —
**verified present 2026-07-19** (`operations_file.repo.js:26`, `final_invoice.repo.js:37`,
`app_user.repo.js:138`); confirm they survive `npm run lint`/`npm test`.
**Settings tiles with genuinely NO endpoint:** only factory languages + help center (everything else,
incl. document templates / custom fields / policies, is on the generic `/settings` store).

Run these on Windows and report/fix results (authoritative validators — the sandbox bash
mount is unreliable for freshly-written files; see **Sandbox gotcha** below):

```
npm run lint
npm test
npm run build --prefix client
```

**Windows validation done 2026-07-15 (re-confirmed after the identity + Finance + field-mask
changes):** `npm run lint`, `npm test`, and `npm run build --prefix client` all pass. Earlier that
day: fixed a **test-isolation bug** (not FE-related): `tests/jest.setup.js` now blanks the
external-provider vars (`GROQ_API_KEY`, `GEMINI_API_KEY`, `SMTP_HOST`, etc.) so the developer's
local `.env` no longer leaks placeholder keys (`__rotate*me__`, `__host__`) into unit tests and
defeats the "not configured / no sender" guards in `services/ai/*` + email. Test-only change; on a
clean checkout / CI those 3 tests already passed.

To preview the app: `npm run dev` (backend, repo root) + `cd client && npm run dev`
(Vite). Set `VITE_TENANT_HOST` to the provisioned tenant (e.g. `smartls.praxisls.com`).
Check the new `/login` landing + the top-bar nav / More sidebar first.

