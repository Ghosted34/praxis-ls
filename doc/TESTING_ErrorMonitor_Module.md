# Error Command Center — Testing & Validation Guide

Companion to `doc/PROMPT_ErrorMonitor_Module.md`. Use this to verify the build
against the spec.

**Version:** Phase 1 · **Date:** 2026-08-06

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
migrations/platform/0080_error_monitor.sql
src/shared/observability/stack-parse.js
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
```

**Files modified:** `error-reporter.js`, `realtime/index.js`, `jobs/workers.js`,
`config/env.js`, `middleware/platform-auth.js`, `modules/platform/platform.routes.js`,
`platform-console/src/{App.tsx,components/Shell.tsx,features/Overview.tsx,package.json}`.

---

## 1. Setup

```bash
# 1. Migrate the platform DB (adds 4 tables + 3 capabilities)
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

New env var — `ERROR_ESCALATION_INTERVAL_MS` (default `60000`, `0` disables
escalation while leaving capture and the dashboard fully working).

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

| Check                   | Result at handover       |
| ----------------------- | ------------------------ |
| Backend lint (17 files) | 0 errors, 0 warnings     |
| Migration numbering     | OK, no new collisions    |
| Migration reversibility | 19 checked, all declared |
| Console typecheck       | 0 errors in `src/`       |

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

| Item                                       | Status                                                                                                                                                                                                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-house notification **delivery**         | The Share modal copies the payload; `POST /api/admin/notifications/push` from the spec does not exist in this codebase. Escalation's in-house channel broadcasts over the socket and logs to `error_escalation_log`. Needs the console notification surface to land. |
| `escalation_delay_minutes`                 | Stored, validated and surfaced in the UI; the evaluator currently gates on `repeat_interval_minutes` only. A rule with a non-zero delay fires on the first matching sweep rather than waiting.                                                                       |
| Rule dry-run (`/escalation/rules/preview`) | Endpoint exists; no UI button yet.                                                                                                                                                                                                                                   |
| `GET /api/admin/health` (uptime %)         | Not built. The Overview widget derives status from error counts rather than showing a fabricated uptime figure. `platform.error_escalation_log`'s sibling `admin_health_metrics` table was intentionally **not** created — there is no collector to fill it.         |
| PII sanitisation (§11)                     | The AI explain path deliberately omits `context` (request_id, user_id, URL). There is no general-purpose scrubber over `message`; the logger's existing `REDACT_PATHS` is not applied to error text.                                                                 |
| Per-tenant escalation rules                | Schema and API support `tenant_id`; the settings UI creates platform-wide rules only.                                                                                                                                                                                |
| Tests                                      | No Jest specs added. §3 above is the executable substitute; the repo has `jest.config.js` if you want them formalised.                                                                                                                                               |

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
