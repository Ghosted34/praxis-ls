# Error Command Center — Testing & Validation Guide

Companion to `doc/PROMPT_ErrorMonitor_Module.md`. Use this to verify the build
against the spec.

**Version:** Phase 3 · **Date:** 2026-08-08

> **Phase 2** (§9) — `/errors` returned 500 on every call (`t.name` vs
> `display_name`); fixed in the service and in the console, where the same
> mistake made the scope dropdown show slugs. Four §7 gaps closed: the
> escalation delay clock, PII scrubbing, per-tenant rules, the rule dry-run.
>
> **Phase 3** (§10) — the last two gaps closed: in-house notification
> **delivery** (durable rows, a bell, RBAC-resolved escalation audience) and a
> real **uptime** figure with a collector behind it. Plus the live feed bug:
> the WebSocket was dialling the Vite dev server, so the console had been on
> polling the whole time and said so in a badge nobody read as a failure.
>
> **Phase 4** (§11) — spec conformance audit. Five defects, headed by
> escalation email that had never sent and recorded success for it. Plus the
> remaining Appendix A items and the drawer's occurrence strip.
>
> **§10.4 is not optional** — six new routes mean `generate-api-docs --check`
> and `check-api-contract` fail until regenerated.
>
> **The spec is IMMUTABLE.** `PROMPT_ErrorMonitor_Module.md` is the contract.
> Where the build diverges, this document records the divergence and the reason
> — the spec is never edited to match what was built. Where the spec states a
> requirement that CAN be met, "amend the spec" is not an available answer:
> that is why the realtime budget moved the code (§12.2) rather than the number.

---

## 0. What was built, and where

The spec was written against an assumed stack (NestJS, `/api/admin/*`, Tailwind,
Zustand, React Query). The repo is different, so the contract was honoured and
the implementation adapted. **Read this table before testing** — several spec
paths deliberately resolve elsewhere.

| Spec says                        | Actually built                                                     | Why                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `/api/admin/errors/*`            | `/api/platform/errors/*`                                           | The admin API is `/api/platform`. There is no `/api/admin` namespace in this codebase.                                         |
| Route `/admin/error-center`      | `#/error-center` (+ `#/admin/error-center` redirects)              | `platform-console` **is** the admin app, host-gated to `admin.praxisls.com`. The `/admin` prefix would be doubled.             |
| NestJS exception filters         | Express `middleware/error-handler.js`                              | The backend is plain JS/Express, not NestJS.                                                                                   |
| Tailwind + Zustand + React Query | Console's existing `ui.tsx` + `useAsync` + CSS vars                | The console is a deliberately 4-dependency app. Only `socket.io-client` was added.                                             |
| New error-capture layer          | Extended the **existing** `shared/observability/error-reporter.js` | Capture, fingerprinting, dedupe and rate limiting already existed and were already wired into the error handler.               |
| `admin_error_logs` table         | `platform.error_event` in the **platform** DB                      | Isolation is one DB per tenant; platform-wide errors have no tenant DB to live in, and the console holds no tenant connection. |

**Files added**

```
migrations/platform/0090_error_monitor.sql
migrations/platform/0092_platform_notification.sql
migrations/platform/0093_health_sample.sql
src/shared/observability/stack-parse.js
src/shared/observability/scrub.js
src/services/platform/notifications.service.js
src/services/platform/health.service.js
src/jobs/handlers/health-collect.js
platform-console/src/components/NotificationBell.tsx
src/shared/observability/error-store.js
src/services/platform/errors.service.js
src/services/platform/error-explain.service.js
src/services/platform/error-escalation.service.js
src/services/platform/error-share.service.js
src/realtime/platform-ns.js
src/modules/platform/errors/{errors.controller,errors.routes,errors.validator}.js
src/jobs/handlers/error-maintenance.js
platform-console/src/lib/{errors-api.ts,useErrorStream.ts}
platform-console/src/features/{ErrorCenter,ErrorCenterSettings}.tsx
platform-console/src/components/{ErrorDetailDrawer,ShareErrorModal,SystemHealthWidget}.tsx
platform-console/src/types/socket.io-client.d.ts
src/services/platform/platform-mail.service.js
tests/unit/error-monitor.test.js
tests/unit/platform-notifications-health.test.js
tests/unit/platform-mail.test.js
```

**Files modified:** `error-reporter.js`, `error-store.js`, `realtime/index.js`,
`jobs/workers.js`, `config/{env.js,logger.js}`, `services/email.service.js`
(exports `transportFrom`), `middleware/platform-auth.js`,
`modules/platform/platform.routes.js`, `tests/jest.setup.js`,
`platform-console/src/{App.tsx,vite.config.ts,components/Shell.tsx,features/Overview.tsx,package.json}`.

**Migration count:** three, not one — `0090` (error monitor), `0092`
(notifications), `0093` (health samples). §1's "adds 4 tables" is now 8.

---

## 1. Setup

```bash
# 1. Migrate the platform DB (0090 + 0092 + 0093 — 8 tables, 3 capabilities)
node scripts/db/migrate-platform.js

# 2. Install the console's new dependency
cd platform-console && npm install && cd ..

# 3. Start API, worker and console
npm run dev                       # API on :8080
node src/jobs/workers.js          # worker (retention + escalation)
cd platform-console && npm run dev # console on :5174
```

Sign in at `http://localhost:5174` as a **PLATFORM_ROOT_ADMIN**. Root bypasses
capability checks; any other role needs `errors.read` granted under **Roles**.

New env vars:

- `ERROR_ESCALATION_INTERVAL_MS` (default `60000`, `0` disables escalation while
  leaving capture and the dashboard fully working).
- `HEALTH_SAMPLE_INTERVAL_MS` (default `60000`, `0` disables uptime sampling).
  **This value is also the unit historical samples are read in** — see §10.2.

The worker is now required for two things rather than one: escalation _and_
uptime sampling. `npm run dev` alone gives you a working feed with a `—` uptime.

---

## 2. Automated checks (all currently passing)

Run these first; they need no database.

```bash
# Backend syntax + lint
npx eslint src/shared/observability/ src/services/platform/error*.js \
           src/realtime/platform-ns.js src/modules/platform/errors/ \
           src/jobs/handlers/error-maintenance.js

# Migration gates
node scripts/db/check-migration-numbers.js        # → no new collisions
node scripts/db/check-migration-reversibility.js  # → all declared

# Console typecheck
cd platform-console && npx tsc -p tsconfig.json --noEmit
```

| Check                                   | Result at Phase 4 (2026-08-08, executed)  |
| --------------------------------------- | ----------------------------------------- |
| Backend lint (`npx eslint src/ tests/`) | 0 errors, 20 warnings — ceiling is 136    |
| Migration numbering                     | OK, no new collisions                     |
| Migration reversibility                 | 35 checked, all declared                  |
| Destructive migrations                  | none unmarked                             |
| Schema drift                            | 236 tables, none with conflicting columns |
| `check-jest-mock-hoisting.js`           | clean                                     |
| `check-write-route-validators.js`       | clean                                     |
| `generate-api-docs.js --check`          | in sync                                   |
| Console typecheck                       | 0 errors in `src/`                        |
| Console lint                            | 0 errors, 8 warnings                      |
| Error-module suites (6 files)           | 138 tests, all passing                    |

> **`check-api-contract.js` and `npm run build` must be run on a machine where
> every module loads.** In a degraded environment the tenant module loader skips
> what it cannot `require()` and the contract script reports those routes as
> REMOVED — 276 of them in one run here, purely because native bindings would
> not load. Running `--update` from that state would delete them from the
> contract and the guard would go quiet about a real removal later. Confirm
> `mountReport()` returns `skipped: 0` first.

---

## 3. Unit-level behaviour you can verify without a database

Paste each block into `node -e` from the repo root.

### 3.1 Stack parsing → module, file, line (criterion #2)

```bash
node -e "
const {parseStack}=require('./src/shared/observability/stack-parse');
const r=parseStack(['TypeError: x',
 '    at createShipment (/app/src/modules/logistics/shipments/shipment.service.js:89:14)',
 '    at async assignDriver (/app/src/modules/logistics/shipments/shipment.controller.js:142:5)',
 '    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)'].join('\n'));
console.warn(r.primary.module, r.primary.file+':'+r.primary.line);
console.warn('vendor frame flagged:', r.frames[2].vendor);
"
```

**Expect:** `shipments src/modules/logistics/shipments/shipment.service.js:89`
and `vendor frame flagged: true`. Also handles Firefox/Safari `fn@url:1:2`
browser stacks and returns `{frames:[],primary:null}` for null input.

### 3.2 Coalescing — a hot loop must not become N statements

```bash
node -e "
const s=require('./src/shared/observability/error-store');
const calls=[]; s.__setQuery(async(q,p)=>{calls.push(p);return{rows:[]}});
const mk=m=>({fingerprint:'E|'+m,message:m,severity:'error',origin:'server',ts:new Date().toISOString(),stack:'E\n    at f (/app/src/modules/x/y.js:1:1)'});
for(let i=0;i<5000;i++) s.persist(mk('hot'));
s.persist(mk('other'));
s.flush().then(()=>console.warn('statements:',calls.length,'| count:',calls.find(c=>c[1]==='E|hot')[16]));
"
```

**Expect:** `statements: 2 | count: 5000`.

### 3.3 The key invariant — counting is NOT deduped

This is the single easiest thing to get wrong. The reporter suppresses repeat
_notifications_ for 5 minutes; if persistence inherited that suppression,
`occurrence_count` would undercount massively and **every escalation threshold
would silently never fire**.

```bash
node -e "
process.env.NODE_ENV='test';
const s=require('./src/shared/observability/error-store');
let n=0; s.__setQuery(async(q,p)=>{n+=p[16];return{rows:[]}});
const rep=require('./src/shared/observability/error-reporter');
const e=new Error('same'); e.stack='E\n    at f (/app/src/modules/x/y.js:1:1)';
Promise.all(Array.from({length:50},()=>rep.report(e))).then(async r=>{
  await s.flush();
  console.warn('deduped notifications:',r.filter(x=>x.reason==='deduped').length,'| persisted:',n);
});" 2>/dev/null | tail -2
```

**Expect:** `deduped notifications: 49 | persisted: 50`.

### 3.4 Share templates (Appendix B)

```bash
node -e "
const s=require('./src/services/platform/error-share.service');
const t=s.build({id:'e1',signature:'sig',level:'fatal',origin:'server',name:'TypeError',
 message:\"Cannot read property 'id' of undefined\",module:'shipments',route:'POST /api/shipments/assign',
 file_path:'shipment.controller.js',line_number:142,occurrence_count:23,tenant_slug:'smartlog',
 first_seen:new Date(Date.now()-3*3600e3).toISOString(),last_seen:new Date().toISOString(),stack_trace:[]},
 {baseUrl:'https://admin.praxisls.com'});
console.warn(t.whatsapp.text); console.warn('---'); console.warn(t.email.subject); console.warn('---'); console.warn(t.plain);
"
```

**Expect** the WhatsApp block to match Appendix B field-for-field
(`🔴 [PRAXIS-LS] Fatal Error Detected`, `❗ Error:`, `📦 Module:`, `🔗 Route:`,
`📄 Location:`, `⏱ Occurred:`, `🔁 Count:`, `🔗 View in Admin:`) and the subject
to be `[PRAXIS-LS] [FATAL] shipments — …`.

> Note: the spec's Appendix B writes **`PRAXXIS-LS`** (double X) in the mailto
> example. That is a typo in the spec; the implementation uses `PRAXIS-LS`
> consistently. Flag it if a test asserts the misspelling.

### 3.5 Query validation / injection resistance

```bash
node -e "
const {QUERY_SCHEMAS:Q,BODY_SCHEMAS:B}=require('./src/modules/platform/errors/errors.validator');
console.warn('sort injection :', Q.errorList.safeParse({sort:'; DROP TABLE x'}).success);
console.warn('bad level      :', Q.errorList.safeParse({level:'banana'}).success);
console.warn('limit > 100    :', Q.errorList.safeParse({limit:'5000'}).success);
console.warn('webhook w/creds:', B.ruleCreate.safeParse({name:'r',action_webhook_url:'https://u:p@evil/x'}).success);
console.warn('ftp webhook    :', B.ruleCreate.safeParse({name:'r',action_webhook_url:'ftp://evil/x'}).success);
"
```

**Expect:** all five `false`.

---

## 4. Acceptance criteria (spec §13)

Generate test errors first:

```bash
# Server-side 500s
curl -s http://localhost:8080/api/platform/__nonexistent__ -H "Authorization: Bearer $TOKEN"

# Browser-origin errors (unauthenticated by design)
curl -s -X POST http://localhost:8080/api/client-errors \
  -H 'Content-Type: application/json' \
  -d '{"message":"Cannot read property id of undefined","name":"TypeError","kind":"window","stack":"TypeError: x\n    at createShipment (/app/src/modules/logistics/shipments/shipment.service.js:89:14)"}'
```

Errors appear within ~2s (the store's flush window).

| #   | Criterion                                              | How to verify                          | Expected                                                                                                                   |
| --- | ------------------------------------------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | Real-time, no refresh                                  | Open Error Center, fire the curl above | Card appears without reload; badge reads **🔴 Live**                                                                       |
| 2   | Exact module + line                                    | Open any card                          | Module and `file:line` shown on the card and in the drawer                                                                 |
| 3   | AI explains in plain language                          | Drawer → **🤖 Explain this error**     | Sections: what/why/which module/fix. Needs a DeepSeek or Gemini key in Integrations, else a clear `AI_UNAVAILABLE` message |
| 4   | One-click LLM-friendly copy                            | Card → **📋 Copy**                     | Clipboard holds the `plain` block from §3.4                                                                                |
| 5   | Share via 3 channels                                   | Card → **🔗 Share**                    | WhatsApp opens `wa.me`, Email opens `mailto:`, in-house picks a platform user                                              |
| 6   | 30-day history + trend                                 | Set range to _Last 30 days_            | Activity chart renders with **empty buckets included** (quiet periods look quiet, not absent)                              |
| 7   | Filter by level/module/time/**tenant & platform-wide** | Use the filter bar                     | Scope dropdown lists _All / Platform-wide / each tenant_; KPI cards move with the filter                                   |
| 8   | WebSocket → polling fallback                           | Stop the API, wait ~10s, restart       | Badge: 🔴 Live → ⚠ Offline → 📡 Polling → 🔴 Live (retries every 30s)                                                      |
| 9   | Manual resolve + who                                   | Click **✓ Resolve**                    | Row leaves the Active feed; under _Resolved_ it shows the resolver's name                                                  |
| 10  | Rules per tenant + platform-wide                       | `#/error-center/settings`              | Create/edit/delete; scope line shows tenant or platform-wide                                                               |
| 11  | Email + in-house on rules                              | Set threshold 1/1min, trigger an error | Within `ERROR_ESCALATION_INTERVAL_MS`, a row lands in `platform.error_escalation_log`                                      |
| 12  | Overview shows uptime + error rate only                | Open `#/overview`                      | Compact **System health** card; no full KPI row                                                                            |
| 13  | Error Center shows full KPIs                           | Open `#/error-center`                  | Total / Fatal / Unique / Resolved / Avg fix                                                                                |
| 14  | Theme consistency                                      | Both pages                             | Uses the console's existing card/pill/button styles                                                                        |

---

## 5. API contract (spec §6)

All under `/api/platform`, `Authorization: Bearer <platform token>`, envelope
`{ data }` / `{ error: { code, message, fields? } }`.

| Method                    | Path                              | Cap                                |
| ------------------------- | --------------------------------- | ---------------------------------- |
| GET                       | `/errors`                         | `errors.read`                      |
| GET                       | `/errors/recent`                  | `errors.read`                      |
| GET                       | `/errors/stats`                   | `errors.read`                      |
| GET                       | `/errors/trends`                  | `errors.read`                      |
| GET                       | `/errors/modules`                 | `errors.read`                      |
| GET                       | `/errors/export?format=csv\|json` | `errors.read`                      |
| GET                       | `/errors/:id`                     | `errors.read`                      |
| GET                       | `/errors/:id/share`               | `errors.read`                      |
| POST                      | `/errors/:id/explain`             | `errors.read` + 10/min limit       |
| POST                      | `/errors/:id/resolve` · `/reopen` | `errors.resolve`                   |
| GET/POST/PATCH/PUT/DELETE | `/escalation/rules[/:id]`         | `errors.read` / `errors.configure` |
| GET                       | `/escalation/log`                 | `errors.read`                      |

`GET /errors` params: `page`, `limit` (≤100), `level` (csv), `status`
(`active`\|`resolved`\|`all`, default `active`), `scope` (`all`\|`platform`),
`tenant`, `module`, `signature`, `search`, `from`, `to`,
`sort` (`recent`\|`count`\|`severity`).

**Capability tests** — with a `PLATFORM_SUPPORT` user (granted nothing new by
0080):

```bash
curl -i .../api/platform/errors                      # → 403 FORBIDDEN
curl -i -X POST .../api/platform/errors/<id>/resolve # → 403 FORBIDDEN
```

**Rate limit:** 11 rapid `POST /errors/:id/explain` → the 11th returns 429.

### WebSocket

Namespace `/platform`, handshake `auth: { token }`.

- Rejects a **tenant** token (`typ:"access"`) → `WRONG_AUDIENCE`
- Rejects a user without `errors.read` → `FORBIDDEN`
- `emit("subscribe", { tenant_id: "<slug>" | "platform" | "all" })`
- Server emits `new_error` and `error_resolved` with the §6 §4.1 payload shape

---

## 6. Verified by inspection only — please confirm on a real database

No PostgreSQL was available in the build environment, so **every SQL statement
is unexecuted**. Treat this as the highest-risk area and check it first.

1. **Migration applies cleanly** — `node scripts/db/migrate-platform.js`.
2. **The UPSERT conflict target resolves.** `error-store.js` infers
   `ON CONFLICT (COALESCE(tenant_id, '000…'::uuid), signature)`, which must match
   the expression index `ux_error_event_sig` exactly. If it does not, inserts
   fail with _"no unique or exclusion constraint matching the ON CONFLICT
   specification"_. Fire the same error twice and confirm `occurrence_count`
   becomes 2 rather than creating two rows.
3. **Platform-wide dedupe.** Two errors with `tenant_id IS NULL` and the same
   signature must collapse to one row — this is why the index uses `COALESCE`
   (plain `NULL` never equals `NULL` in a unique index).
4. **`trends` bucketing** — `date_trunc($n, …)` with a _parameterised_ unit and
   `generate_series` over timestamptz.
5. **`platform.set_updated_at()`** exists (used by the three new triggers).
6. **Reopen-on-recurrence** — resolve an error, fire it again, confirm
   `resolved_at` returns to NULL.

---

## 7. Known gaps / deliberate deferrals

### Still open

| Item                              | Status                                                                                                                                                                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Historical rows predate scrubbing | The scrubber runs at capture time, so rows written before Phase 2 keep whatever they captured. Retention is 30 days, so this ages out rather than needing a backfill. Force it earlier with `DELETE FROM platform.error_event WHERE created_at < now()` if a leak is suspected.          |
| Rule scope is fixed at creation   | `ruleUpdate` deliberately has no `tenant` field — moving a live rule between tenants silently changes who gets paged. Delete and recreate.                                                                                                                                               |
| Uptime measures the WORKER's view | The collector runs in the worker, so the figure conflates "the API was down" with "the worker was down". Deliberate — see §10.2 — but it means a worker stopped for maintenance shows as an outage. Set `HEALTH_SAMPLE_INTERVAL_MS=0` before planned worker downtime, or accept the dip. |
| Notification email digest         | Notifications land in the bell and over the socket. There is no "you have 3 unread" email for someone who never opens the console; escalation's `action_email` covers the urgent case and this would duplicate it.                                                                       |

### Closed in Phase 2

| Item                                   | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `escalation_delay_minutes` was ignored | The evaluator now runs a real delay clock. First matching sweep writes an ARMING row (`actions_taken @> '{"pending":true}'`) instead of notifying; a later sweep delivers once the delay has elapsed **and** the condition still holds; a sweep where it no longer matches deletes the arming row, so a blip pages nobody. Durable rather than an in-memory Map, because the sweeps that matter happen during an incident — which is exactly when the process restarts. `recentlyFired` now counts deliveries only. |
| PII sanitisation (§11)                 | New `src/shared/observability/scrub.js`, called from `report()` **before** the fingerprint, the webhook, the log line and the database — so all four sinks are covered by one call site rather than four promises. Catches emails, connection-string credentials, JWTs, `Bearer` tokens, provider API keys, PEM blocks, Luhn-valid card numbers and any `key=value` whose key is in the logger's `SENSITIVE_KEYS` (imported, not restated). File paths, line numbers and uuids are deliberately untouched.          |
| Per-tenant escalation rules            | The settings page has a scope selector next to **+ Add rule**. Every rule anyone could previously create was platform-wide, which meant one noisy tenant paged on behalf of all of them.                                                                                                                                                                                                                                                                                                                            |
| Rule dry-run                           | **Test rule** button on each rule card, wired to `POST /escalation/rules/preview`. Runs against the _draft_ thresholds, not the saved ones. `preview` now accepts a `tenant` scope so the dry-run matches what will be saved; an unknown slug is a 404 rather than a silent widening to platform-wide.                                                                                                                                                                                                              |
| Tests                                  | `tests/unit/error-monitor.test.js` — 30-odd assertions covering stack parsing, coalescing, the dedupe-vs-count invariant, the scrubber, the delay clock's arm/fire/disarm lifecycle, the Appendix B templates and validator rejection. §3's `node -e` blocks are kept as a database-free smoke path.                                                                                                                                                                                                                |

---

## 8. Spec defects found while implementing

1. **Section numbering is corrupted.** §6 contains subsections 4.1–4.3, §7
   contains 5.1–5.2, §8 contains 6.3, §9 contains 7.1–7.3, and §14 precedes §13.
2. **`PRAXXIS-LS`** (double X) in §3.3 and Appendix B — should be `PRAXIS-LS`.
3. **"Avg Fix 2.3s" was undefined.** Implemented as mean wall-clock
   `resolved_at − first_seen` over errors resolved in the window; renders `—`
   when nothing has been resolved rather than showing a misleading `0`.
4. **§2.1 assumes the console can use the existing Socket.IO layer.** It cannot —
   that layer requires a tenant token and a resolvable tenant host, and the
   console has neither. Hence the separate `/platform` namespace.
5. **§2.2's schema has `tenant_id UUID NOT NULL`.** Platform-wide errors (the
   ones that matter most in an outage) have no tenant, so the column must be
   nullable.

---

## 9. Phase 2 — the bug, and what changed

### 9.1 `/errors` returned 500 on every call

```
DatabaseError: column t.name does not exist
  hint: Perhaps you meant to reference the column "e.name".
  at Object.list (src/services/platform/errors.service.js:146)
```

`SELECT_COLUMNS` projected `t.name AS tenant_name`. `platform.tenant` has no
`name` column — it is `display_name` (`migrations/platform/0010_tenant_registry.sql:25`).

The failure pattern is worth keeping, because it is what identified the line
without a debugger: `/errors`, `/errors/recent` and `/errors/:id` returned 500
while `/errors/stats`, `/errors/trends` and `/errors/modules` returned 200.
All six share the same `LEFT JOIN platform.tenant t`; only the first three
project a column from it. **A join is not evidence that a column exists.**

The same mistake had been made a second time, in the console:
`ErrorCenter.tsx` declared a local `type Tenant = { slug: string; name: string }`
for the scope dropdown. `GET /tenants` returns `display_name`, so `t.name` was
always `undefined` and every option silently fell back to the slug. TypeScript
had nothing to object to — structural typing checks the shape you declared, and
the shape was simply declared wrong. Both now derive from the real column: the
query selects `t.display_name`, and the console picks its fields off
`TenantListRow` rather than restating them.

**Regression check** — with the API up and a platform token:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://localhost:8080/api/platform/errors?status=active&limit=1' | jq '.data.items[0].tenant_name'
```

Expect a display name or `null`, not a 500. Then open `#/error-center` and
confirm the scope dropdown shows tenant NAMES rather than slugs.

### 9.2 What to test in the closed gaps

| Gap              | How to verify                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delay clock      | Create a rule with threshold 1/1min and **delay 2 min**. Fire an error. Within one sweep a row appears in `platform.error_escalation_log` with `actions_taken = {"pending":true}` and **nothing is sent**. After 2 minutes the next sweep sends and replaces that row. Now resolve the error mid-wait and confirm the pending row is deleted instead — a blip must page nobody. |
| Scrubbing        | `curl -X POST .../api/client-errors -d '{"message":"login failed for a@b.cm via postgres://u:p@db/x"}'` then read the row: no `a@b.cm`, no `:p@`, and the file path/line intact.                                                                                                                                                                                                |
| Per-tenant rules | `#/error-center/settings` → pick a tenant in the dropdown → **+ Add rule**. The new card's scope line reads `tenant · <slug>`, and `matchesFor` restricts to that tenant's rows.                                                                                                                                                                                                |
| Dry-run          | **Test rule** on any card. Change the threshold without saving and press it again — the count must move, because it runs against the draft.                                                                                                                                                                                                                                     |

### 9.3 Not yet executed

No PostgreSQL and no Node runtime were available in the environment these
changes were written in, so the following are **verified by inspection only**
and want a real run before merge:

```bash
npx eslint src/ tests/                       # expect 0 new warnings (ratchet is 136)
npx jest tests/unit/error-monitor.test.js    # the new suite
npx jest --coverage                          # the CI gate
node scripts/check-jest-mock-hoisting.js     # the new suite uses doMock, which is exempt
node scripts/generate-api-docs.js --check    # no routes added or removed — expect no diff
node scripts/check-api-contract.js
cd platform-console && npx tsc -p tsconfig.json --noEmit && npm run lint && npm run build
```

The highest-risk items in that list are the console typecheck (two files gained
imports and a changed local type) and the new Jest suite's fake for
`platform.error_escalation_log`, which has to distinguish `clearStaleArming`
from `disarm` by whether `$2` is an array.

---

## 10. Phase 3 — the last two gaps, and the WebSocket bug

### 10.1 In-house notification delivery (§3.3, §5.3)

Two features shipped against a channel that did not exist. The Share modal's
"send to a team member" **copied the payload to the clipboard** and told the
operator to paste it somewhere. Escalation's `action_inhouse` emitted a socket
event and wrote to `error_escalation_log` — and a socket event reaches whoever
has the console open _at that instant_, which for a rule whose whole purpose is
to catch a 3am outage is nobody. socket.io does not queue for absent clients, so
the event was simply gone. Both worked perfectly in a demo.

**What landed**

```
migrations/platform/0092_platform_notification.sql
src/services/platform/notifications.service.js
platform-console/src/components/NotificationBell.tsx
```

plus `pushNotification()` and a per-user socket room in `realtime/platform-ns.js`,
five routes on the errors router, and a real `sendNotification()` behind the
Share modal's button.

Three decisions worth knowing:

- **The row is the delivery; the socket push is a courtesy.** `create()` writes
  first and pushes second, and a push failure is swallowed. The inverse ordering
  is what produced the original gap.
- **The audience comes from RBAC, not a recipient list.** `notifyCapable()`
  resolves everyone with `errors.read`, plus every `PLATFORM_ROOT_ADMIN` (root
  bypasses `requireCap`, so a permissions-table-only query would exclude exactly
  the people who can see everything). Granting the capability in the console is
  the single action that puts someone on call.
- **Reads are not capability-gated.** A notification addressed to you is yours.
  Gating it would let a `PLATFORM_SUPPORT` user be sent something they then
  cannot open. _Sending_ is gated on `errors.read` — you may only forward an
  error you are allowed to see.

Dedupe is per `(recipient, signature)` for 30 minutes, independent of the rule's
`repeat_interval_minutes`, because several rules can match one signature and
three identical bells for one incident is how a bell stops meaning anything.

**Verify**

| What                            | How                                                              | Expect                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Share → in-house                | Any error → **Share** → pick a recipient → **Send notification** | Toast names the recipient. Sign in as them: bell shows a red badge, and the item opens the error.                           |
| Escalation fan-out              | Rule with threshold 1/1min, `action_inhouse` on, fire an error   | Within one sweep every `errors.read` holder has a notification. `actions_taken` on the log row records `in_house: <count>`. |
| Dedupe                          | Fire the same signature again inside 30 min                      | `actions_taken.in_house_suppressed` is non-zero; no second bell.                                                            |
| Authorisation                   | `POST /notifications/<someone-else's-id>/read`                   | `404 NOT_FOUND` — the `to_user_id` predicate is the auth check.                                                             |
| Delivery survives a dead socket | Stop the console, fire an escalation, sign back in               | The notification is there. This is the entire point.                                                                        |

### 10.2 Uptime (§8.2, criterion #12)

`admin_health_metrics` was deliberately not created in 0090 because nothing
would fill it, and a table that reads empty is worse than an absent one. That
reasoning was right; what changed is that there is now a producer. **The
collector landed before the table, which is the order these two have to go in.**

```
migrations/platform/0093_health_sample.sql
src/services/platform/health.service.js
src/jobs/handlers/health-collect.js
```

`GET /api/platform/health/summary` is the spec's `GET /admin/health`. It is
distinct from the unauthenticated `/api/health/ready`, which answers "can this
process serve _right now_" for a load balancer; this one is historical,
authenticated, and reads a table rather than probing anything.

**The flaw every self-hosted uptime number has, and what was done about it.**
The obvious query is `avg(healthy::int)`. It is wrong in the one direction that
matters: the collector runs inside the platform's own worker, so during an
outage it writes _no row at all_. The outage contributes zero unhealthy samples
and the average reports 100% for the week you were paged three times.

So the denominator is **expected** samples, from wall-clock elapsed time and
`HEALTH_SAMPLE_INTERVAL_MS`, not rows present. A missing sample is downtime.
Two clamps, both because the naive version lies on day one: `expected` starts at
the _first_ sample (a deployment migrated an hour ago would otherwise report
0.14% over 30 days), and `healthy` is capped at `expected` (clock skew must not
produce 100.3%).

> `HEALTH_SAMPLE_INTERVAL_MS` is not just a cadence — it is the unit historical
> rows are interpreted in. Samples written at 60s and read back assuming 300s
> report a fifth of the real uptime. Change it once, early, or purge the table
> with it.

**Verify**

```bash
# after migrating and starting the worker, wait ~3 minutes
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://localhost:8080/api/platform/health/summary?days=1' | jq
```

- `uptime_percent` near 100, `collector: "running"`, `samples` ≈ `expected_samples`.
- Stop the worker for two minutes, restart, re-query: `uptime_percent` **drops**.
  If it does not, the denominator is being read from the table and the number is
  worthless.
- With `HEALTH_SAMPLE_INTERVAL_MS=0`: `uptime_percent: null`, `collector:
"disabled"`, and the Overview widget renders `—` rather than a figure nothing
  is measuring.

### 10.3 The live feed was never live in dev

Reported from a running console: the badge sat on **📡 Polling** and devtools
showed `WebSocket connection to 'ws://localhost:5174/socket.io/' failed`.

`vite.config.ts` proxied `/api` but not `/socket.io`. The console dials the page
origin — which in dev is Vite, not the API — Vite has no socket.io server, the
handshake is refused, and `useErrorStream` did exactly what it was built to do:
degraded to polling and said so. **Nothing was red.** Acceptance criteria #1 and
#8 were both unmet, and the obvious test (open the page, fire an error, watch it
appear) still passed — ten seconds late.

Fixed by proxying `/socket.io` with `ws: true` (the Upgrade handling is the
whole point; forwarding the GET alone connects once and drops), and by adding
`tryAllTransports: true` to the client — socket.io-client 4.8 stopped falling
through the transport list on its own, so a blocked WebSocket degraded to our
10-second poll when long-polling would have kept the feed live.

**Verify:** restart `npm run dev` in `platform-console`, reload, and the badge
must read **🔴 Live** with no WebSocket error in the console.

### 10.4 Regenerate the contract and docs — REQUIRED

Six routes were added, so two CI gates will fail until these are run. Both files
say "GENERATED — do not edit by hand", and hand-editing them would be reverted
by the next run:

```bash
node scripts/check-api-contract.js --update   # doc/api-contract.json
node scripts/generate-api-docs.js             # doc/API_REFERENCE.md, doc/ERROR_CODES.md
```

New routes: `GET|POST /notifications`, `GET /notifications/unread-count`,
`POST /notifications/read-all`, `POST /notifications/:id/read`,
`GET /health/summary`.

Migrations 0092 and 0093 both carry `-- DOWN` blocks and are additive, so
`check-migration-reversibility.js` and `check-destructive-migrations.js` should
pass unchanged. `check-migration-numbers.js` should be clean — 0092/0093 were
free (0090 error monitor, 0091 mail fallback).

---

## 11. Phase 4 — spec conformance audit (2026-08-08)

A section-by-section re-read of the spec against the built module. Five defects
found, all fixed; the remaining divergences are listed as decisions.

### 11.0 Does the platform mailer clash with the existing email work?

No, and the check is worth recording because it easily could have.

`doc/EMAIL_TWO_CONFIGS.md` defines exactly **two** email configurations, and the
temptation was to add a third. `services/platform/platform-mail.service.js` is
instead a second _consumer_ of System email's bottom tier — the same
`mail.fallback` platform setting, the same `no-reply@praxisls.com`, the same
deploy-wide SMTP, resolved by the same `mail-fallback.service`.

Verified:

- **No call-site collision.** Every existing caller of `email.service.send()`
  passes a tenant `client`; the platform mailer is the only path without one.
- **One nodemailer configuration.** `email.service.transportFrom` is now
  exported and the platform mailer calls it rather than rebuilding the
  transport. TLS options and the `secure` port rule are deliverability-critical
  and two copies drift silently — the symptom being mail that sends on one path
  and bounces on the other. Asserted in `tests/unit/platform-mail.test.js`.
- **Same From rule (G-4).** No caller may override `from` on the fallback relay,
  because a foreign From fails SPF/DKIM/DMARC. Enforced by not accepting the
  parameter; asserted.
- **No `email_send_log` write.** That table is per-tenant and platform mail has
  no tenant; logging it under an arbitrary one would be worse than not logging
  it. The `error_escalation_log` row is the durable record. Asserted.

`doc/EMAIL_TWO_CONFIGS.md` now has a "Platform-only mail rides the fallback
tier" section so the doc stops being incomplete rather than the code being
undocumented.

### 11.1 Escalation email had never sent — and said it had

The worst finding in the module, because it failed _positively_.

```js
enqueue("email-send", { to, subject, text }); // error-escalation.deliver()
```

Three faults in one line:

1. **The queue is named `email`.** `workers.js` registers
   `{ name: "email", handler: require("./handlers/email-send") }` — `email-send`
   is the handler FILE. Jobs went to a queue with no worker and sat in Redis.
2. **Wrong arity.** `enqueue(name, jobName, data, opts)` — the payload was passed
   where the job name goes, so `data` was `undefined`.
3. **Even corrected it could not work.** `handlers/email-send.js` opens with
   `if (!tenantMeta) throw` — and platform-wide escalation has no tenant, by
   definition. There was no platform-level mailer at all: `email.service.send()`
   needs a tenant `client`, and `resolveMail` only consults the platform
   fallback when one is present.

`enqueue` resolved, so `taken.email = <recipients>` was written to
`error_escalation_log`. **The audit trail recorded a page that never went out.**
"Why was I not called at 3am" had an answer and the answer was false.

Fixed with `services/platform/platform-mail.service.js` — a deploy-wide sender
over `mail.fallback` (Console → Integrations → Mail fallback, env underneath).
It returns `{ok:false, reason}` rather than throwing, and `deliver()` now records
what happened instead of what was attempted: an unconfigured relay reads
`email_error: "no_smtp_configured"`.

**Verify:** set a rule's recipients, fire an error, then
`SELECT actions_taken FROM platform.error_escalation_log ORDER BY triggered_at DESC LIMIT 1;`
Before this, `email` was always populated. Now it is populated only on a real send.

### 11.2 Worker crashes were invisible (§2.3 point 2)

`workers.js` handled `unhandledRejection` and `uncaughtException` by LOGGING
only — to a box whose logs are wiped every deploy (OBS-L7). `error_event.origin`
has a `'worker'` value in its CHECK constraint that nothing outside a job handler
ever wrote. Both now call `report()`.

This is the wrong process to leave silent: the worker evaluates escalation rules
and samples uptime, so a dead worker is also the thing that will not tell anyone
it died.

### 11.3 `notice` and `info` could never be produced

`error-store.levelOf()` was three branches — fatal, warning, else error. The
column accepted five, the CHECK listed five, §9.1 defined colour tokens for five,
and the filter bar rendered five chips. **Two of those chips were dead controls**
that returned an empty feed forever, reading as "no notices today" rather than
"this level does not exist". `levelOf` now passes any of the five through.

### 11.4 No audit log for resolutions or shares (§11)

Required by the spec, absent entirely. Now writes to `platform.platform_audit` —
the table tenants/plans/roles already use, rather than a feature-local log —
as `error.resolved`, `error.reopened` and `error.shared`.

`reopen` matters most: it NULLs `resolved_by`, so without an audit row the only
record of who called an error fixed is destroyed by whoever disagreed, and
neither name survives.

`GET /errors/:id/share` is the audited point for sharing because the WhatsApp and
mailto legs leave the browser without touching the server again — it is the last
moment "who took a stack trace out of the console" can be recorded at all.

### 11.5 The Jest open handle

`persist()` arms a 2s flush timer; `flush()` did not clear it. Unref'd, so it
never blocked an exit — but it fired after Jest tore the environment down and
`db()` lazily requires the platform pool, producing _"You are trying to `import`
a file after the Jest environment has been torn down"_, reported as a worker
that failed to exit gracefully. `flush()` now clears the timer it is satisfying.

### 11.6 Closed in the same pass

| Spec                             | What landed                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Appendix A.5 — stale detection   | `health.captureHealth()`, surfaced on the Overview widget as a banner and in `GET /health/summary` as `capture`. See 11.8 for why silence alone is not the signal.                                                                                                                                                |
| §3.2 — 30-day occurrence strip   | Per-signature day bars in the drawer, from `/errors/trends?signature=…`. **This also fixed a latent bug:** `errorTrends` did not accept `signature`, and zod strips unknown keys silently — the strip would have rendered every error in the platform under one error's heading with nothing reporting a problem. |
| §3.2 — `[📥 Download Trace]`     | Built client-side from the drawer's own payload — no endpoint, since a round trip would only add a way for the two to disagree. Filename carries signature + date so traces saved during one incident do not collide.                                                                                             |
| Appendix A.8 — multi-select copy | Checkbox per card, selection bar, one clipboard block. Fetches sequentially: N share-payload builds fired at once at a database already under incident load is what the escalation evaluator is designed to avoid.                                                                                                |

### 11.7 Divergences kept, with reasons

| Spec                                                     | Status                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §2.3 pt 4 — capture API validation failures              | **Now done, at `notice`** — see 11.9.                                                                                                                                                                                                                                        |
| Appendix A.4 — logging health checks (disk, writability) | Not built. The product no longer writes errors to a log FILE — capture goes to Postgres — so "is the log file writable" has no subject. Disk monitoring belongs with the host, not here. A.5 (stale detection) was the half of this pair that still applied, and it is done. |
| Spec §10 — performance budgets                           | Partly measured, and **one is knowably over budget by design**. See §12 below.                                                                                                                                                                                               |
| Spec §12 — E2E share flow, polling-fallback simulation   | Not built. Covered by unit tests and the manual steps in §4.                                                                                                                                                                                                                 |

### 11.8 Why stale detection is not "no rows for an hour"

A genuinely quiet platform writes no errors, and crying wolf at 3am on a good
night is how an alert gets muted. So silence alone is not the signal.

The signal is silence **while the platform is demonstrably alive** — which is
what `health_sample` knows and `error_event` cannot:

- health samples still arriving → the worker and the database are fine
- and no error in 24h → _capture_ is suspect, not the platform

A quiet night has both silent. A broken pipeline has one silent and one not.
`stale` is therefore only ever true when we can prove we were watching, and
`reason` (`capturing` / `no_errors_while_healthy` / `collector_down` /
`insufficient_history`) says which state we are in so the UI never guesses.

This matters because it is the **only failure in this module the dashboard
cannot show you as a wrong number.** Everything else surfaces as a bad figure;
broken capture renders a clean, empty, green feed — and "zero errors" reads as
"everything is fine".

### 11.9 §2.3 pt 4 — validation failures, captured without muting the channel

The spec says "Backend **must** capture errors from … 4. API validation
failures". It was deliberately skipped, and the reason was sound: a 422 is a
client mistake, and an alert channel whose first week is "email is required"
gets muted — the OBS-A1 failure mode this whole module exists to avoid.

**Both are satisfiable, and §2.2's five levels are what reconciles them.**
Validation failures are now captured at **`notice`**, which required one change
in the reporter to make safe:

`NOTIFY_SEVERITIES = {fatal, error, warning}`. Below that threshold `report()`
persists and counts, then stops — no webhook post, no dedupe bookkeeping, and
crucially **no rate-limit spend**. That last one matters as much as the first:
the ceiling is 20 outbound reports a minute, and if a broken signup form could
burn it, a genuine 500 arriving in the same minute would be dropped. Noise must
not be able to starve signal.

Two details worth knowing:

- **Both validator styles are caught.** `ZodError` is the obvious one, but the
  ~90 module validators throw `AppError("VALIDATION_ERROR", …, 422)`. Catching
  only the Zod branch would have missed nearly all of them.
- **The message is synthesised, not passed through.** A `ZodError`'s own
  `message` is a JSON dump of every issue, so it would fingerprint differently
  for each combination of bad fields and one broken form would produce hundreds
  of groups. Keying on route + sorted field names makes "this endpoint keeps
  getting bad input for these fields" ONE row with a rising count.

Nothing pages: `notice` never reaches the webhook, and escalation rules default
to `fatal`.

**The pre-existing test `does NOT report a validation error` passes unchanged**,
which is the proof that the old guarantee survived — it measures what reaches
the webhook, and that answer is still "nothing". Four new tests in
`error-reporting.test.js` assert the other half: persisted at `notice`, still
unreported, rate limit untouched after 30 failures, and repeated bad input
carrying one signature rather than one per attempt.

> That last test failed on its first run asserting "one statement". Five
> sequential requests outlive the 250 ms leading edge, so several flush cycles
> legitimately occur; grouping is done by the UPSERT's `ON CONFLICT`. The
> property to assert is one SIGNATURE and counts summing to five. Same mistake
> as §12.2's storm test — statements are not groups.

---

### 11.10 A warning about `check-api-contract.js`

Run it **only on a machine where every module loads.** In a degraded environment
the tenant module loader skips what it cannot `require()`, and the script then
reports those routes as REMOVED — 276 of them in one run here, purely because
native modules would not load. Running `--update` from that state would delete
them from the contract and the guard would go quiet about a real removal later.

Confirm `node -e "…mountReport()"` reports `skipped: 0` before trusting it.

## 12. Performance budgets (spec §10)

> **Note on section numbers.** "§10.2" elsewhere in THIS file means this
> document's section 10 (Phase 3). "Spec §10" means the performance
> requirements in `PROMPT_ErrorMonitor_Module.md`. They are different things and
> the collision is this document's fault; qualified from here on.

### 12.1 Why these are different from every other spec item

The other thirteen spec sections describe features — they exist or they do not,
and you can look. Spec §10 describes SPEEDS, and a speed is the only kind of
claim here that can be false while everything looks correct. A slow dashboard
works. It just stops being opened, and nobody files a bug saying "the feed takes
four seconds" — they quietly go back to reading logs.

| Budget                       | Clock starts            | Clock stops              | Status                                  |
| ---------------------------- | ----------------------- | ------------------------ | --------------------------------------- |
| Initial load < 2s (first 20) | Click Error Center      | 20 cards on screen       | **Unmeasured**                          |
| Realtime < 500ms             | Backend logs an error   | Card appears, no refresh | **Met — 12.2**, asserted in tests       |
| AI explanation < 5s          | Click 🤖 Explain        | Text renders             | **Unmeasured** (provider-bound)         |
| Stack parsing < 100ms        | Error reaches the store | Frames structured        | **0.027 ms** — passes, 3,700× margin    |
| Share modal < 200ms          | Click 🔗 Share          | Modal usable             | **Unmeasured — and 12.3 made it worse** |

Reproduce the two that are answered:

```bash
node -e "
const {parseStack}=require('./src/shared/observability/stack-parse');
const s=['TypeError: x',...Array.from({length:60},(_,i)=>'    at fn'+i+' (/app/src/modules/x/y.js:'+(i+10)+':14)')].join('\n');
for(let i=0;i<1000;i++) parseStack(s);
const t=process.hrtime.bigint(); for(let i=0;i<10000;i++) parseStack(s);
console.log('parse', Number(process.hrtime.bigint()-t)/1e7, 'ms/call');
"
```

Stack parsing was never going to be close — pure regex, capped at 40 frames.
Confirming it costs nothing and removes it from the list permanently. The
scrubber added in Phase 2 sits on the same path at 0.003 ms/call, so §11's PII
work did not spend the budget either.

### 12.2 The realtime budget — MET as of 2026-08-08

> **The spec is immutable.** "Amend the budget to 2 s" was the recommendation
> below and it is not available: `PROMPT_ErrorMonitor_Module.md` is the contract,
> so the code had to move rather than the number. The original analysis is kept
> underneath because the trade it describes is still real — it is now resolved
> rather than accepted.

**What changed.** `error-store` had one flush window for everything:
`FLUSH_MS = 2000`. The console broadcast rides `flush()` (`onPersist` fires
after the UPSERT), so that window WAS the realtime latency — 0–2000 ms, ~1 s
average, against a 500 ms budget.

The window now depends on whether the signature is new:

|                                    | Window             | Why                                                                                                                |
| ---------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **First sighting** of a signature  | `LEADING_MS = 250` | Not a hot loop by definition — it is the thing that needs to reach a screen. 250 ms + one UPSERT is inside 500 ms. |
| **Repeat** of a buffered signature | `FLUSH_MS = 2000`  | Already rendered; only its count is moving. This is what keeps a hot loop to one statement.                        |

The insight is that the two goals were never actually in conflict. The 2 s window
exists to survive thousands of occurrences of the SAME error; a signature nobody
has seen before is not that. The 250 ms floor is measured from the last flush, so
a storm of thousands of DISTINCT errors still batches — that case is now better
than before, not worse.

`schedule()` also had to learn to REPLACE a pending timer when the new request is
sooner. Its old `if (timer) return` meant a repeat that armed the 2 s window
would swallow the leading-edge request of a genuinely new error arriving 10 ms
later, leaving it unrendered for the rest of that window — the exact latency
being removed.

**Asserted, not assumed** — `error-monitor.test.js`:

- _"flushes a FIRST sighting on the leading edge"_ — measures wall clock, fails over 500 ms
- _"still coalesces repeats"_ — 5,000 occurrences → 1 statement, `count = 5000`
- _"batches a storm of DISTINCT signatures into one flush"_ — 150 signatures, timestamp spread under one window

> Note on that last one: the first version counted STATEMENTS and failed at 150.
> 150 distinct signatures legitimately need 150 UPSERTs — there is no multi-row
> form. The property worth asserting is that they land in ONE flush cycle, which
> the timestamp spread shows. The test was wrong, not the code.

<details>
<summary>Original analysis (kept — the trade is still real)</summary>

### The realtime budget is missed on purpose, and nobody reconciled it

```
error-store.FLUSH_MS = 2000
```

Writes are buffered for two seconds, and the socket broadcast fires INSIDE the
flush — `store.setListener(broadcastError)` is invoked from `onPersist`, which
only runs after the UPSERT returns. So realtime latency is **0–2000 ms,
averaging ~1 s**, against a 500 ms budget. It misses roughly three quarters of
the time, and not because anything is slow: it is waiting deliberately.

The buffering is correct. It is what turns a hot loop firing 40,000 times into
ONE statement rather than 40,000 — the difference between the monitoring
surviving an incident and becoming it (see error-store's header). What is wrong
is that the spec number and the architecture have disagreed since day one and
neither was updated.

Three ways to close it. This is a product decision, not a defect to patch:

1. **Amend the budget to 2 s.** Cheapest and honest. The "🔴 Live" badge stays
   truthful — two seconds still reads as live to a human, and the fallback it
   distinguishes itself from polls at ten.
2. **Broadcast from `persist()` instead of `flush()`.** Meets 500 ms easily, but
   a pre-persist payload has no `error_id` and no `occurrence_count`, both of
   which the feed renders. The card would arrive incomplete and need patching on
   the next flush — more moving parts on the path that must not break.
3. **Lower `FLUSH_MS` to ~400 ms.** Meets the budget and multiplies write
   pressure fivefold during exactly the storm the buffer exists to absorb.
   Recommended against.

Option 2 is effectively what shipped, in a cheaper form: rather than broadcasting
an incomplete payload before persistence, the PERSISTENCE was brought forward for
the one case that needs it. The card still arrives complete.

</details>

### 12.3 The share budget got tighter, and it was this work that tightened it

§11.4 put an `INSERT` into `platform.platform_audit` on `GET /errors/:id/share`,
awaited before the response. That is a database write inside a 200 ms budget.

It is in the right place — the WhatsApp and mailto legs leave the browser without
touching the server again, so this endpoint is the last moment "who took a stack
trace out of the console" can be recorded at all. But it is not free, and if the
share modal ever measures over budget, this is the first thing to look at. The
cheap fix if it does: drop the `await`, since `audit()` already swallows its own
failures.

### 12.4 What the remaining three need

Not a load-testing rig — a populated table and the browser Network panel:

- **Initial load** fires five requests in parallel (`/errors`, `/errors/stats`,
  `/errors/trends`, `/errors/modules`, `/tenants`), and `/errors` itself runs two
  queries: the rows, and a `COUNT(*)` over the same filtered join. On a near-empty
  table this is instant. **The COUNT is the part that degrades**, and 30 days of
  real traffic is where it would show.
- **AI explanation** is provider-bound (DeepSeek → Gemini). A cached signature
  returns from Redis in single-digit ms; only the cold path can miss, and the
  drawer already shows a loading state.
- **Share modal** — see 12.3.

Seed a few thousand groups first, or the numbers describe an empty database
rather than a working one.

---

---

## 13. Full spec walk-through (2026-08-08, re-read line by line)

§11's audit was done from memory of a single early read of the spec plus greps
into the code. That found five real defects, but it also **missed two items**,
which is exactly what an audit conducted from memory should be expected to do.
This section is the re-read: every spec section opened and compared.

### 13.1 What the re-read caught that §11 did not

| Spec                                                                               | Finding                                                                                                                                       | Status                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §3.4 — Time Range includes **Custom** with a date picker                           | The control had five fixed windows and no custom option. `from`/`to` were already accepted by the API and validator; only the UI was missing. | **Built.** `hours === 0` sentinel + two date inputs. The `to` date is inclusive of the chosen END DAY — a range "1st to 3rd" that silently excludes the 3rd is the classic off-by-one here. `trendHours` derives a real span for the activity chart, because the trends endpoint 422s on a non-positive `hours`. |
| §3.1 — the card action row names **`[🤖 Explain]`** first                          | Card had Trace / Copy / Share / Resolve. No Explain.                                                                                          | **Built**, opening the drawer rather than generating inline — §7.1's "on-demand" cost rule applied to the feed, since one-click Explain on twenty cards is twenty model calls one misclick apart.                                                                                                                |
| Appendix A.3 — **multi-location tracking**, "show all files where an error occurs" | Never assessed in §11. Not built, and not buildable as designed.                                                                              | **Divergence, see 13.3.**                                                                                                                                                                                                                                                                                        |

### 13.2 Verified present, section by section

| Spec                                                                             | Verdict                                                           |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| §2.1 hybrid transport, 10s poll, 30s reconnect, visible mode                     | ✓ `useErrorStream` — `POLL_MS`, `RECONNECT_MS`, `ConnectionBadge` |
| §2.2 schema, five levels, 30-day retention                                       | ✓ `0090`, purge job at 02:00 UTC                                  |
| §2.3 capture points 1,2,3,5                                                      | ✓ (pt 4 is a deliberate divergence — 13.3)                        |
| §3.1 five KPI cards (Total/Fatal/Unique/Resolved/Avg Fix)                        | ✓ all five                                                        |
| §3.1 24h activity chart                                                          | ✓ `ActivityChart`                                                 |
| §3.2 Location / Stack Trace Analysis / AI Explanation / Occurrences / Raw Sample | ✓ all five blocks                                                 |
| §3.2 `[🔄 Regenerate]` `[📋 Copy Explanation]`                                   | ✓                                                                 |
| §3.2 `[📋 Copy Full Error] [📥 Download Trace] [🔗 Share]`                       | ✓ (Download added §11.6)                                          |
| §3.3 three channels + preview + copy                                             | ✓                                                                 |
| §3.4 Status / Level multi-select / Module / Search                               | ✓ search covers message, file_path, route, raw_stack              |
| §4.1–4.3 scope model, tenant filter, capability tiers                            | ✓                                                                 |
| §5.1 rule shape, §5.2 settings page, §5.3 flow                                   | ✓ delay clock added §10                                           |
| §6 all 14 REST endpoints                                                         | ✓ present, renamed per §0                                         |
| §6 §4.1 WebSocket `new_error` / `error_resolved` / subscribe / unsubscribe       | ✓                                                                 |
| §7 DeepSeek→Gemini, Redis 1h TTL, 4-point system prompt                          | ✓ prompt matches the spec's wording verbatim                      |
| §9.1 severity colour tokens                                                      | ✓ hex values match exactly                                        |
| §13 all 14 acceptance criteria                                                   | ✓ (#1 subject to the realtime budget — §12.2)                     |

### 13.3 Divergences — with the reason, not just the fact

| Spec                                                            | Built                                                  | Why                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Appendix A.3 — show all files where an error occurs             | Not built                                              | The fingerprint deliberately includes the top stack frame, so the same message thrown from two places stays TWO problems (see `error-reporter.fingerprint`). Multi-location aggregation would require the opposite decision. The drawer shows every frame of one error; it cannot show every location of one message. **Revisiting this means changing the fingerprint, which changes every existing signature.** |
| §2.3 pt 4 — capture API validation failures                     | Not captured                                           | A 422 is a client mistake. Routing them to the feed buries real faults under "email is required" and gets the channel muted (OBS-A1). Asserted in `error-reporting.test.js`.                                                                                                                                                                                                                                      |
| §4.3 `admin.errors.view/resolve/configure`                      | `errors.read/resolve/configure`                        | The platform tier has no `admin.` prefix on any capability; adding one for this module alone would break the console's permission matrix rendering.                                                                                                                                                                                                                                                               |
| §7.1 `recent_occurrences` (last 3 timestamps) in the AI context | Sends `first_seen` + `last_seen` + `occurrence_count`  | The grain is one row per signature; individual occurrence timestamps are not stored, by the design decision in `0090` that keeps the table bounded. Storing them would undo the aggregation the whole feature rests on.                                                                                                                                                                                           |
| §8.3 eleven named component files                               | Inlined in `ErrorCenter.tsx` / `ErrorDetailDrawer.tsx` | The console is a flat four-dependency app with no `features/*/components/` convention. Eleven files for one screen would be the only such tree in the codebase.                                                                                                                                                                                                                                                   |
| §9.2 typography: Inter                                          | Montserrat + JetBrains Mono                            | `npm run check:fonts` **fails the build** on any font not in the approved list, and Inter is not in it. The mono choice matches the spec.                                                                                                                                                                                                                                                                         |
| §3.3 recipient "Search user… ▾"                                 | Plain `<select>`                                       | Platform staff are a handful of people. A search control over a five-item list is worse than a list. Revisit if the platform user count grows.                                                                                                                                                                                                                                                                    |

### 13.4 Spec §12 testing requirements — done

`tests/unit/error-monitor-flows.test.js`, 27 tests covering four of the five;
the fifth (unit tests for parsing/normalisation) was already
`error-monitor.test.js`.

| Spec §12                                   | Where                               | Notes                              |
| ------------------------------------------ | ----------------------------------- | ---------------------------------- |
| Unit tests for error parsing/normalization | `error-monitor.test.js`             | 28 tests                           |
| Integration tests for WebSocket events     | `error-monitor-flows.test.js` §12.2 | 11 tests                           |
| E2E tests for share flow                   | §12.3                               | 5 tests — **see the caveat below** |
| AI explanation response validation         | §12.4                               | 7 tests                            |
| Polling fallback simulation                | §12.5                               | 4 tests                            |

**What "E2E" means here, stated honestly.** The share tests drive the real
router, controller, service and payload builders through supertest — everything
except the browser and the database, both doubled. That is an INTEGRATION test.
Calling it E2E would overstate it: nothing proves `window.open` fires or that a
mailto handler exists. Browser-level E2E needs Playwright added to
`platform-console` (the tenant `client` has it; the console does not), and that
is listed as work rather than faked here.

The WebSocket suite drives the namespace through a socket.io Server double
rather than a live wire, because `socket.io-client` is not a root dependency.
The auth decisions, room membership and broadcast targeting — everything with
logic in it — are exercised directly.

Worth recording: the first version of the §12.4 tests reported three failures
against correct code, because the database double returned the error row for the
`error_explanation` lookup as well, which reads as a permanent cache hit. The
fix was in the test.

### 13.5 Still genuinely open

1. **Spec §10 performance budgets** — see §12. Three unmeasured, one over budget by design.
2. **Browser E2E for the console** — needs Playwright in `platform-console`.
3. **Appendix A.3** — a decision, not a task. See 13.3.

Everything else in the spec is either built or has a written reason.

---
