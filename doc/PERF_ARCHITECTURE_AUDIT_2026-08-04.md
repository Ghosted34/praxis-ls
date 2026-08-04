# Praxis LS — Performance & Architecture Deep Audit

**Date:** 2026-08-04
**Scope:** Whole stack — Node/Express API, PostgreSQL data layer, BullMQ workers, Socket.IO
realtime, React/Vite tenant SPA, React/Vite platform console.
**Status:** Phase 0 — **audit only, no code changed.** Nothing in the roadmap below is
implemented. It is a proposal awaiting review and sign-off.
**Independence:** This is a standalone workstream. It does not overlap with, depend on, or
assume anything from the parallel UI/UX audit.

---

## 0. How to read this

Every finding is tagged:

| Tag | Meaning |
|---|---|
| **MEASURED** | Backed by a number produced in this audit against a real, running system. The command and the raw plan are reproducible from §1.1. |
| **STATIC** | Derived from reading the code. No measurement was possible — the reason is stated. |
| **Quick win** | Localised change, low blast radius, no architectural rework. |
| **Structural** | Requires an architectural decision and a staged migration. |

Severity is **impact under real production traffic**, not code aesthetics.

### 0.1 What could NOT be measured — stated explicitly

The task asked for measurements wherever possible and explicit honesty where not. These are
the gaps:

| Area | Status | Why |
|---|---|---|
| Live/staging environment | **Not available** | No deployed environment is reachable from this session. All DB measurements were taken against a **Postgres 16.13 instance provisioned locally from this repo's own `migrations/tenant/*.sql`**, seeded with synthetic data. Schema is real; data distribution is synthetic. |
| Production traffic profile | **Not available** | Load numbers below are synthetic closed-loop tests, not replayed production traffic. They characterise *the shape* of the bottleneck (where it saturates and why), not absolute production capacity. |
| pgvector / AI embedding paths | **Not measured** | `pgvector` is not installable in this sandbox. `vector(N)` columns were shimmed to `real[]` and the `ivfflat` index dropped so the rest of the schema would load. **No conclusion is drawn about AI/RAG query performance.** It remains unaudited and should get its own pass. |
| Browser render profiling (React DevTools Profiler, Lighthouse, real FCP/LCP/TBT) | **Not available** | No browser automation was run against a live app. Frontend **bundle numbers are real** (produced by the repo's own `vite build`). Re-render findings are **STATIC** — code-level reasoning, not profiler traces. Flagged as such individually. |
| Redis behaviour under load | **Partially** | Redis was not exercised in the load test. The benchmark measures the **cache-miss** path. The cache-**hit** path is *cheaper in queries* but still pays every pool checkout and `SET search_path` — which is the finding that matters (S2). |
| Real network latency to Postgres | **Not modelled** | All DB timings are over a **local Unix socket (≈0 ms RTT)**. Production round-trips carry real network latency. This makes every round-trip-count finding **worse in production than measured here**, not better. |

### 0.2 Architecture as actually built (verified against files, not assumed)

```
Host header ─► hostTenantResolver ──► registry.resolveByHost()  [60 s in-proc cache]
                                          │  platform DB: subdomain ⋈ tenant ⋈ tenant_database
                                          ▼
               tenantContext ──► req.tenantDb(fn)   → pool for THAT tenant's own Postgres, search_path=live|sandbox
                             └─► req.identityDb(fn) → same pool, search_path=live (identity is env-independent)
                                          │
               authMiddleware      ──► req.identityDb(…)  ← pool checkout #1 + SET search_path
               requirePermission   ──► req.identityDb(…)  ← pool checkout #2 + SET search_path
               controller          ──► req.tenantDb(…)    ← pool checkout #3 + SET search_path
```

Confirmed properties:

- **Database-per-tenant**, not schema-per-tenant (`doc/DB_ARCHITECTURE.md` §1 governs; the code
  matches it). `live` and `sandbox` are schemas *inside* each tenant DB.
- **No ORM.** Plain `pg` + hand-built SQL via `src/shared/db/query-helpers.js`.
- **93 feature modules** under `src/modules/**`, auto-mounted by `src/shared/http/module-loader.js`.
- **42,497 LOC** backend across 981 JS files; **38,818 LOC** frontend TS/TSX across 2 SPAs.
- **184 tenant tables** defined; 183 loaded cleanly into the benchmark DB.

---

## 1. Measurements

### 1.1 Reproduction

```bash
service postgresql start
createdb tenant_bench
# vector(N) -> real[], ivfflat index removed (pgvector unavailable); everything else verbatim
psql -d tenant_bench -f migrations/tenant/0001_extensions.sql
for f in migrations/tenant/*.sql; do psql -d tenant_bench -c 'SET search_path=live,public;' -f "$f"; done
# seed: 200k lead rows, 19,510-node scope tree, 500 users
```

Environment: PostgreSQL 16.13, local Unix socket, warm shared_buffers, single node,
Node.js v22. All figures are **best-case** for that reason.

### 1.2 Headline result — one authenticated `GET /api/tenant/leads`

Replicating the exact middleware chain (`authMiddleware` → `requirePermission` → controller)
against the real schema:

| # | Step | As shipped | With indexes added |
|---|---|---:|---:|
| 1 | `SET search_path` (auth) | 0.32 ms | 0.36 ms |
| 2 | `getAuthUser` | 3.30 ms | 3.61 ms |
| 3 | `SET search_path` (rbac) | 0.36 ms | 0.46 ms |
| 4 | `getGrants` | 1.02 ms | 1.10 ms |
| 5 | `getUserScopeClosure` | **8.42 ms** | 3.11 ms |
| 6 | `SET search_path` (controller) | 0.26 ms | 0.44 ms |
| 7 | `repo.list` | **53.29 ms** | 2.43 ms |
| | **Total** | **67.64 ms** | **12.28 ms** |
| | **DB round-trips** | **7** | **7** |

**5.5× faster from indexes alone.** The round-trip count does not move — that is S2, and it
is the structural half of the problem.

### 1.3 Load test — where it saturates

Same request path, `TENANT_POOL_MAX=8` (the real default, `src/config/env.js:66`), indexes present:

| Concurrency | req/s | p50 | p95 | p99 |
|---:|---:|---:|---:|---:|
| 1 | 319 | 2.9 ms | 4.5 ms | 8.2 ms |
| 5 | 838 | 5.3 ms | 10.7 ms | 16.0 ms |
| 10 | 1056 | 8.9 ms | 13.8 ms | 16.8 ms |
| 25 | 1154 | 21.1 ms | 26.5 ms | 28.6 ms |
| 50 | 1210 | **41.6 ms** | 45.4 ms | 46.9 ms |

Throughput plateaus at ~1,200 req/s while **p50 grows 14× (2.9 → 41.6 ms)**. That is textbook
queueing on a saturated resource: the connection pool. Because each request takes **three**
checkouts, effective request concurrency is `pool_max / 3` ≈ **2.7 in-flight requests per tenant**.

### 1.4 Tenant capacity — the hard cliff

Modelling `registry.service.js poolFor()` (one `pg.Pool` per tenant DB, `max: 8`):

```
  tenant  1 warm ->   8 backend connections held
  tenant  6 warm ->  48 backend connections held
  tenant 12 warm ->  96 backend connections held

  *** Postgres refused while warming tenant 13
  *** sorry, too many clients already

  Max concurrently-active tenants for ONE api process: 12
  Connections consumed: 100 of max_connections=100
```

**MEASURED: 12 concurrently-active tenants per API process**, then hard failure.

### 1.5 Query plans — the generic list path

`src/shared/crud/resource.js:51` emits `SELECT * FROM <t> … ORDER BY created_at DESC LIMIT/OFFSET`
for every module. Against 200,000 `lead` rows:

| Query | As shipped | Fixed | Gain |
|---|---:|---:|---:|
| List page 1 | 26.34 ms (parallel seq scan, 3,710 buffers) | **0.057 ms** (index scan, 4 buffers) | **462×** |
| Deep page (`OFFSET 100000`) | 100.43 ms — **external merge sort, 8.0–9.6 MB spilled to disk per worker** | 16.95 ms | 5.9× |
| Search `ILIKE '%…%'` | 66.96 ms (seq scan, 200k rows filtered) | **4.55 ms** (GIN `pg_trgm` bitmap) | **14.7×** |

### 1.6 Index coverage

```sql
-- tables with a created_at column but NO index on it
123     -- of 126 total
```

**123 of 126 tables** ordered by an unindexed column. Per-file: `0110_rbac.sql` (8 tables),
`0300_masterdata.sql` (4), `0320_costing_procurement.sql` (7), `0330_hr_fleet_wms.sql` (11),
`0345_commercial.sql` (6), `0350_sales_crm.sql` (13), `0360_hr_breadth.sql` (12),
`0370_wms_fleet_depth.sql` (11) — **all declare zero explicit indexes.**

### 1.7 Frontend bundle — real `vite build` output

**Tenant SPA (`client/`)**

```
dist/assets/index-*.js            294.53 kB │ gzip: 83.64 kB
dist/assets/vendor-react-*.js     152.30 kB │ gzip: 49.07 kB
dist/assets/vendor-*.js           138.16 kB │ gzip: 50.72 kB
dist/assets/dashboard-mock-*.js   106.27 kB │ gzip: 24.10 kB   ← a MOCK, shipped to production
dist/assets/feature-hr-*.js        99.82 kB │ gzip: 23.66 kB
dist/assets/feature-finance-*.js   95.65 kB │ gzip: 22.52 kB
… 10 more feature chunks …

TOTAL JS:  1,318.0 KB raw │ 365.3 KB gzip
PWA precache: 20 entries (1,383.41 KiB)
```

**Every one of the 16 chunks is `<link rel="modulepreload">`ed in `dist/index.html`.** The
`manualChunks` splitting improves cache granularity across deploys but does **not** reduce
first-load bytes — `client/src/app/app.tsx` imports all 46 route components statically, so the
whole application is in the initial module graph. The build also emits **9 circular-chunk
warnings** between feature chunks, so they cannot be loaded independently anyway.

Also measured: **0 `React.lazy` / `Suspense`** and **0 `React.memo`** across 134 `.tsx` files.

**Platform console (`platform-console/`)**: 232.37 kB raw / 70.51 kB gzip — single chunk, no
splitting at all.

### 1.8 Response compression

`compression` is declared in `package.json` but **never mounted** — `grep` over `src/` finds no
`app.use(compression())`. `doc/DEPLOYMENT.md` documents no gzip/brotli at the proxy either.

Measured on a real 50-row list response from the benchmark DB:

```
raw JSON: 18,020 bytes
gzipped:   2,381 bytes     → 86.8% reduction (7.6×)
```

---

## 2. Findings

### CRITICAL

---

**S1 — Tenant connection model caps the product at ~12 active tenants per API process** ·
*Structural* · **MEASURED (§1.4)**

`src/services/tenant/registry.service.js:68-92` creates one `pg.Pool` per tenant database,
cached in an unbounded `Map`, `max: TENANT_POOL_MAX` (default **8**, `src/config/env.js:66`).
Postgres ships with `max_connections=100`.

`12 tenants × 8 connections = 96` → tenant 13 gets `sorry, too many clients already`.

The compounding problem: **horizontally scaling the API makes this worse, not better.** Each
new replica opens its own pools. Three API replicas cut tenant capacity to ~4. There is no
PgBouncer in the stack, no pool eviction, no cap on the number of pools, and no backpressure.
`doc/DB_ARCHITECTURE.md:46` anticipates "PgBouncer at 10+ tenants" — that ladder is documented
but **not built**, and the code has no seam for it.

This is the single largest risk to the commercial model. A SaaS whose per-process tenant
ceiling is 12 cannot onboard.

---

**S2 — Three pool checkouts and three `SET search_path` round-trips per request** ·
*Structural* · **MEASURED (§1.2, §1.3)**

`req.identityDb` / `req.tenantDb` (`src/middleware/tenant-context.js:22,29`) each call
`registry.withTenantConnection`, which does `pool.connect()` + `SET search_path = …` (`registry.service.js:100-102`).
The chain calls it three times per request: `auth.js:66`, `rbac.js:91`, `resource.js:159`.

Consequences:
1. **7 DB round-trips for one list request** (§1.2). Over a real network (not this audit's
   0 ms Unix socket) each adds full RTT — 7 round-trips × ~1 ms ≈ 7 ms of pure latency floor.
2. **Effective concurrency is `pool_max / 3`.** With `TENANT_POOL_MAX=8`, ~2.7 in-flight
   requests per tenant before queueing.
3. `SET search_path` is a wasted statement on every checkout — it can be set once per
   connection at pool creation via `options`, or bound with `pool.on('connect')`.
4. **Redis cache hits do not help this.** The identity cache saves *queries*, not *checkouts* —
   the three connect + `SET` round-trips are paid regardless.

---

**S3 — 123 of 126 tables sort by an unindexed `created_at`** · *Quick win* · **MEASURED (§1.5, §1.6)**

`src/shared/crud/resource.js:23` defaults `orderBy = "created_at DESC"`, and all 24 hand-rolled
repos repeat the same clause (e.g. `src/modules/sales/lead/lead.repo.js:20`).

Every list screen in the product therefore runs a **full table scan plus a sort**. At 200k rows
that is 26.34 ms → **0.057 ms with a one-line index (462×)**, buffers 3,710 → 4.

This is the highest value-per-effort item in the audit: a single additive migration, no
application code touched, no behaviour change.

---

### HIGH

---

**S4 — Per-request recursive CTE over an unindexed tree** · *Quick win + Structural* · **MEASURED**

`getUserScopeClosure` (`src/shared/cache/identity-cache.js:180-198`) is called by
`requirePermission` on **every permission-gated request** (`rbac.js:98`) and is **deliberately
not cached** — the source comment at `identity-cache.js:169-173` explains the reasoning
(re-parenting would leave descendants stale).

`scope.parent_scope_id` has **no index** (`migrations/tenant/0110_rbac.sql:36`). The plan shows
`Seq Scan on scope … loops=4` — the entire table re-scanned once per recursion level:

| Tree size | As shipped | With `ix_scope_parent` |
|---|---:|---:|
| 1,510 nodes | 0.89 ms | — |
| 19,510 nodes | **14.78 ms** | **0.92 ms** (16×) |

The index is a quick win. Removing the query from the hot path entirely (cache the closure,
invalidate on `scope` re-parent rather than by user TTL) is the structural fix — and the
correctness concern in the comment is solved by invalidating on the *tree*, not the *user*.

---

**S5 — Notification fan-out is an N+1 inside the business transaction** · *Structural* · **STATIC**

`src/shared/notifications/notify-events.js:104-111` loops over recipients and awaits
`service.notify()` sequentially. Each `notify()` (`src/modules/notification/notification.service.js:92-112`)
issues **~4–5 further queries**: `isChannelEnabled`, `insertForUser`, `deliverEmail`, `deliverPush`.

For an event notifying 50 finance users that is **~250 sequential round-trips while holding a
write transaction open** — pinning a pooled connection (of 8) for the duration and extending
lock windows on the business row. `invoice.posted`, `payment.received` and `dossier.created`
are all on the allowlist, so this is a normal-path cost, not an edge case.

Not measured: needs seeded users, roles and permission grants to be meaningful; the query count
is unambiguous from the code.

---

**S6 — Every write pays 4–6 extra sequential round-trips** · *Quick win* · **STATIC**

`emitEvent` (`src/shared/events/emit.js`) runs on every create/update/archive across all 93
modules and issues, in sequence:

| Line | Statement |
|---|---|
| `emit.js:56` | `SELECT is_security_critical, is_approvable FROM event_type WHERE key = $1` |
| `emit.js:72` | `INSERT INTO event_log …` |
| `emit.js:87` | `executor.start(…)` → 2 more queries when approvable |
| `emit.js:106` | `SELECT full_name … FROM app_user` (security-critical only) |
| `emit.js:121` | `INSERT INTO notification … SELECT` fan-out |
| `emit.js:136` | `notify-events.onEvent(…)` → S5 |
| `emit.js:170` | `INSERT INTO immutable_ledger …` |

`event_type` is a **static seeded catalogue** (`migrations/seeds/9020_seed_rbac_events.sql`) — it
is read on every single write and never cached. Caching it in-process turns a per-write
round-trip into a map lookup, with no behaviour change.

---

**S7 — No HTTP compression anywhere in the stack** · *Quick win* · **MEASURED (§1.8)**

`compression` is a declared dependency and is never mounted in `src/server.js`. No proxy-level
compression is documented in `doc/DEPLOYMENT.md`.

**86.8% payload reduction** measured on a representative list response (18,020 → 2,381 bytes).
This applies to every JSON response *and* to the 1,318 KB of static SPA assets served by
`express.static` at `server.js:186`. One line of middleware.

Compounded by **173 `SELECT *`** occurrences across `src/` — lists ship every column of every
row whether the screen renders them or not.

---

**S8 — The entire frontend loads on first paint; code splitting is cosmetic** · *Quick win* · **MEASURED (§1.7)**

`client/src/app/app.tsx:1-46` statically imports all 46 route components. `vite.config.ts`
`manualChunks` splits the output into 16 files, but **all 16 are `modulepreload`ed** in the
emitted `index.html`, and the build reports **9 circular-chunk warnings** between them.

Net first load: **1,318 KB raw / 365.3 KB gzip of JavaScript** before the router picks a route.
The service worker then precaches **1,383 KiB**. Included in that: `dashboard-mock` at
**106.27 kB** — a mock shipped to paying customers.

The `vite.config.ts` comment at line 78 already identifies the fix ("route-level React.lazy is
the follow-up"). It was never done. **See §4 — the lazy-loading fix has a user-visible timing
consequence and needs explicit sign-off.**

Secondary, same file: `client/index.html:21-25` loads Google Fonts from two external origins
with a **render-blocking** stylesheet — two extra DNS + TLS handshakes on the critical path.

---

**S9 — `invalidateGrants()` blocks Redis and flushes every tenant** · *Quick win* · **STATIC**

`src/shared/cache/identity-cache.js:295-300`:

```js
const keys = await redis.keys("identity:grants:*");
if (keys.length) await redis.del(...keys);
```

Two problems:
1. **`KEYS` is O(N) over the entire keyspace and blocks the Redis main thread.** Redis is also
   serving BullMQ, sessions and rate limiting — everything stalls for the duration.
2. **The keyspace is not tenant-namespaced** (`identity:grants:<roleIds>:<module>`). One tenant
   editing one permission **flushes the RBAC cache for every tenant on the deployment**, causing
   a synchronised cache-miss stampede straight into the connection pools of S1/S2.

Role UUIDs are per-tenant `gen_random_uuid()` (verified in `9020_seed_rbac_events.sql`), so
there is no cross-tenant *data* leak — but the blast radius on invalidation is global.

---

### MEDIUM

---

**S10 — `hostCache` is unbounded and keyed by attacker-controlled input** · *Quick win* · **STATIC**

`registry.service.js:16,59` caches host→meta in a `Map` that is **never evicted**, and it
**caches negative results** (`meta = null`) too. Any client can send arbitrary `Host` headers;
each unknown host allocates a permanent entry *and* costs one platform-DB query. Unbounded
memory growth plus an amplification vector. Needs a max size + TTL sweep.

---

**S11 — 13 BullMQ workers share a single Redis connection** · *Structural* · **STATIC**

`src/jobs/workers.js:46` passes `getClient()` — the **one** shared `ioredis` client from
`src/config/redis.js:60` — as `connection` to all 13 `Worker` instances. BullMQ workers issue
**blocking** commands (`BZPOPMIN`/`BRPOPLPUSH`); they require a dedicated connection each.
Sharing one socket serialises them, and the *same* connection also serves the identity cache and
rate limiter, which then queue behind blocking job reads.

---

**S12 — Socket.IO has no Redis adapter — realtime is single-process only** · *Structural* · **STATIC**

`src/config/redis.js:8` documents "Pub/Sub coordination across Socket.io workers (redis adapter)"
and creates `publisher`/`subscriber` clients — but no adapter is ever attached in
`src/realtime/index.js`. Only `src/realtime/mail-bus.js` uses the publisher.

Consequence: `publish()` reaches only clients connected to **the same Node process**. The moment
the API runs more than one replica, Smart Comms messages are silently delivered to a subset of
recipients. This is a **correctness** failure that only appears under horizontal scaling — i.e.
exactly when the S1 fix forces more replicas.

---

**S13 — A full Chromium process is spawned per PDF** · *Structural* · **STATIC**

`src/services/pdf.service.js:30-42` calls `puppeteer.launch()` and `browser.close()` **inside
the render function**, so every single PDF pays a cold browser start (typically 300–500 ms and
150–250 MB RSS). The `pdf` queue runs `concurrency: 2` (`workers.js:26`), so two Chromium
processes churn continuously under load. No browser pool, no page reuse.
`waitUntil: "networkidle0"` adds an unconditional idle wait on top.

Not measured: Chromium is not installed in this sandbox.

---

**S14 — Context providers defeat memoization app-wide** · *Quick win* · **STATIC**

`client/src/app/auth/auth-context.tsx:237` passes an **inline object literal** as the provider
value, containing six handler functions (`login`, `verify2fa`, `pinLogin`, `registerPin`,
`logout`, `patchUser`) that are **re-created on every render** — none is wrapped in
`useCallback`. `branding-context.tsx:86` has the same shape.

Every render of `AuthProvider` therefore produces a new context identity and **re-renders every
consumer in the tree**, regardless of whether anything changed. With **0 `React.memo`** across
134 components (§1.7) there is nothing to arrest the cascade.

Marked STATIC: no profiler trace was captured (§0.1). The mechanism is unambiguous from the
code; the *magnitude* is not quantified.

---

**S15 — No client-side request cache; unconditional refetch and background polling** · *Quick win* · **STATIC**

`client/src/lib/use-resource.ts` is a hand-rolled fetch hook with **no cache, no request
dedup, and no `AbortController`** — the `live` flag suppresses the state update but the
in-flight request still completes. Every mount refetches; navigating away and back refetches;
two components needing the same list issue two requests. There are **150+ `useList`/`useResource`
call sites**, 21 in `features/sales/pages.tsx` alone.

Separately, `app-shell.tsx:393` polls two endpoints every 60 s per user, forever. At 1,000
concurrent users that is 2,000 req/min ≈ 33 req/s of pure badge polling — and by §1.2 each
costs **7 DB round-trips**, so ≈ **230 DB round-trips/second** for unread counts alone.

---

**S16 — Leading-wildcard `ILIKE` search guarantees a full scan** · *Quick win* · **MEASURED (§1.5)**

`resource.js:33` and the hand-rolled repos build `ILIKE '%' || q || '%'`. A leading wildcard
cannot use a B-tree index. Measured **66.96 ms → 4.55 ms (14.7×)** with a `pg_trgm` GIN index —
no query rewrite required, the same SQL simply becomes indexable.

---

**S17 — `OFFSET` pagination degrades and spills to disk** · *Structural* · **MEASURED (§1.5)**

`query-helpers.js:47-51` clamps `limit` to 200 but `offset` is unbounded. At `OFFSET 100000`
Postgres performs an **external merge sort spilling 8.0–9.6 MB per worker to disk**. Cost grows
linearly with page depth. Keyset pagination is the durable fix — **but it changes the API
contract, see §4.**

---

**S18 — No global rate limiting → noisy-neighbour risk** · *Quick win* · **STATIC**

`express-rate-limit` is applied to exactly **two** password-reset routes
(`src/modules/security/app_user/app_user.routes.js:20-21`). There is no global limiter. Combined
with S1's 12-tenant connection ceiling, **one abusive or buggy tenant can exhaust the shared
Postgres connection budget and take every other tenant down.** `rate-limit-redis` is already a
dependency.

---

### LOW / MAINTAINABILITY

---

**S19 — 50 repos hand-roll an SQL builder that already exists** · *Quick win* · **MEASURED**

`grep` finds the identical `update()` body — `const set = keys.map((k, i) => k + " = $" + (i + 2)).join(", ")` —
copy-pasted into **50 module repos**, despite `query-helpers.updateOne()` doing exactly this. Any
fix (e.g. adding `updated_at` handling, or the S20 hardening) must be applied 50 times.

Similarly there are **76 `*.ai.js` per-module adapters totalling 1,764 lines** — ~23 lines each of
largely mechanical registration.

---

**S20 — SQL identifiers are interpolated from object keys with no enforcement** · *Structural* · **STATIC**

`query-helpers.js:16-22` and `:30` build column lists directly from `Object.keys(data)`:

```js
const cols = keys.join(", ");
```

`makeController.create` (`resource.js:170`) passes `req.body` straight through. Safety depends
**entirely** on every caller whitelisting keys first, with **no enforcement at the helper**.

**I traced this and did not find a live vulnerability**: modules with Zod validators are safe
(`z.object` strips unknown keys and `req.body = p.data` is reassigned — `lead.validator.js`),
and the validator-less write paths I checked whitelist explicitly in the service layer
(`smartcomm.service.js:51`). **89 of 102 route files reference a validator.**

But this is one forgotten whitelist away from SQL injection, in a helper used by every module,
and `makeRouter`'s `validator = {}` default silently applies **no validation at all**. It should
be defended at the helper (validate identifiers against a per-table column allowlist) rather
than relying on 93 modules getting it right forever. **Recommend a dedicated security pass —
this audit was scoped to performance and did not exhaustively trace all 102 route files.**

---

## 3. Scalability — what breaks first, in order

| # | Breaks at | Symptom |
|---|---|---|
| 1 | **13th concurrently-active tenant** (S1) | `sorry, too many clients already`. Adding API replicas *accelerates* this. |
| 2 | **Any table past ~50k rows** (S3) | Every list screen degrades linearly; deep pages spill to disk. |
| 3 | **First multi-replica deploy** (S12) | Smart Comms silently delivers to a subset of users. No error surfaces. |
| 4 | **~2.7 concurrent requests per tenant** (S2) | Latency grows linearly; measured 14× p50 increase to concurrency 50. |
| 5 | **First large org chart** (S4) | 14.78 ms added to *every* gated request at 20k scope nodes. |
| 6 | **One noisy tenant** (S18) | Cross-tenant outage via connection starvation. |

---

## 4. Behaviour-changing proposals — NOT included in any phase, sign-off required

Per the non-negotiable constraint, these are **excluded** from the roadmap below. Each would
unlock a real win but changes something a user or an integrator could notice. None will be
implemented without explicit written approval.

| # | Proposal | Win | Behaviour change | Recommendation |
|---|---|---|---|---|
| **B1** | Route-level `React.lazy` + `Suspense` (S8) | Cuts first-load JS from 365 KB gzip to an estimated 90–120 KB | Navigating to a not-yet-loaded route shows a loading state and requires a network fetch. Offline-after-first-visit behaviour changes unless the SW precache list is tuned. | **Recommend.** Largest frontend win available. Mitigate by keeping the SW precaching all chunks so offline is preserved and only *first paint* changes. |
| **B2** | Remove `dashboard-mock` from the production build (S8) | −106 kB raw / −24 kB gzip | The Control Tower mock stops rendering. If any customer-facing screen still shows it, that screen goes blank. | Needs a product answer: **is the mock still user-visible?** If not, delete. If yes, it is a feature and should be built properly. |
| **B3** | Keyset (cursor) pagination replacing `OFFSET` (S17) | Constant-time deep paging; removes disk spill | **API contract change.** `offset` clients break. "Jump to page N" becomes impossible. | Add cursor support **alongside** `offset`, migrate clients, deprecate later. Do not swap. |
| **B4** | Cache `getUserScopeClosure` (S4) | Removes a query from every gated request | A `scope` re-parent takes up to the TTL to affect permissions instead of being instant. | **Recommend** with tree-level invalidation (invalidate on any `scope` write) — that makes the staleness window effectively zero and preserves current behaviour. Without it, do not ship. |
| **B5** | `SELECT *` → explicit column lists (S7) | Smaller payloads, index-only scans | Any client relying on an undocumented column stops receiving it. | Per-module, behind response-shape tests. Low priority. |
| **B6** | Batch the notification fan-out into one `INSERT … SELECT` (S5) | ~250 round-trips → 1 | Per-user preference checks must move into SQL; a user whose preference row is written mid-transaction could see a different outcome. Ordering of `notification_id` changes. | **Recommend.** The semantics are preservable; needs careful test coverage on `notification_preference`. |

---

## 5. Proposed 5-phase remediation roadmap

**Sequencing rationale:** the worst risk (S1) cannot be fixed safely until the request path stops
consuming three connections per request (S2) — otherwise a pooler just moves the ceiling
slightly. But both are structural and slow. Phase 1 therefore front-loads the **pure-additive,
zero-behaviour-change wins** that are measurable in days and buy headroom for the structural work.
Foundational architecture (Phases 2–3) then lands before targeted tuning (Phase 4), because
tuning against a moving connection model wastes effort.

Every phase ends with a benchmark re-run of §1.2/§1.3/§1.5 so each claim is proven, not assumed.

---

### Phase 1 — Additive quick wins: indexes, compression, cache hygiene

**Objective.** Recover the largest measured wins with changes that are purely additive and
cannot alter behaviour. Buy latency headroom before touching architecture.

**Scope.**
- New migration adding `created_at DESC` indexes across the 123 uncovered tables (S3).
- Index `scope(parent_scope_id)` (S4).
- `pg_trgm` GIN indexes on the columns reachable by `searchColumn` / repo `ILIKE` (S16).
- Mount `compression()` in `src/server.js` (S7).
- Replace `redis.keys()` with `SCAN`, and namespace the identity keyspace per tenant (S9).
- Bound `hostCache` with a max size + TTL sweep (S10).
- In-process cache for the static `event_type` catalogue (S6).
- Global rate limiter using the already-present `rate-limit-redis` (S18).

**Files.** `migrations/tenant/05xx_perf_indexes.sql` (new), `src/server.js`,
`src/shared/cache/identity-cache.js`, `src/services/tenant/registry.service.js`,
`src/shared/events/emit.js`.

**Dependencies.** None. Can start immediately.

**Deliverables.** One additive migration; five bounded code changes; a re-runnable benchmark
harness committed under `scripts/bench/`.

**Validation.**
- Re-run §1.5 plans — assert index scans replace seq scans on every touched table.
- Re-run §1.2 — target **67.64 ms → ≤ 13 ms** for the reference request.
- Assert response `Content-Encoding: gzip` and ~86% payload reduction on a list endpoint.
- `EXPLAIN` regression test in CI asserting no `Seq Scan` on the top 20 list tables.
- Index build time and write-amplification measured on a seeded 200k-row table before rollout.

---

### Phase 2 — Collapse the per-request connection cost

**Objective.** Reduce DB round-trips per request from 7 to ≤ 3 and pool checkouts from 3 to 1,
without changing any response. This is the prerequisite for Phase 3.

**Scope.**
- Introduce a **request-scoped connection**: one checkout per request, reused by
  `req.identityDb` and `req.tenantDb`, released on response finish.
- Set `search_path` **once per physical connection** (via `pool.on('connect')` or libpq
  `options`) instead of per checkout.
- Fold `getAuthUser` + `getGrants` + scope resolution into a **single** identity round-trip on
  cache miss.
- Apply **B4** (scope-closure caching with tree-level invalidation) — *only if signed off*.

**Files.** `src/middleware/tenant-context.js`, `src/services/tenant/registry.service.js`,
`src/middleware/auth.js`, `src/middleware/rbac.js`, `src/shared/cache/identity-cache.js`,
`src/shared/crud/resource.js`.

**Dependencies.** Phase 1 (so improvements are attributable, not confounded by index effects).

**Risk.** Highest-touch phase on the hot path. Identity/RBAC correctness is
security-critical — sandbox/live schema pinning (`tenant-context.js:29`) must be preserved
exactly. Requires full RBAC regression coverage before merge.

**Deliverables.** Request-scoped connection helper; consolidated identity read; unchanged public
API surface, proven by contract tests.

**Validation.**
- **Round-trip assertion test** — instrument `pg` and assert ≤ 3 queries for the reference
  request (down from 7).
- Re-run §1.3 load test — target **p50 at concurrency 50 below 15 ms** (from 41.6 ms) and
  effective concurrency `pool_max/1` rather than `pool_max/3`.
- Full RBAC matrix regression: every role × module × action, live *and* sandbox.

---

### Phase 3 — Break the tenant ceiling

**Objective.** Move from ~12 tenants/process to a model that scales with tenant count and
survives horizontal API scaling. This is the phase that makes the product sellable at volume.

**Scope.**
- Introduce **PgBouncer** (transaction pooling) between the API and tenant databases — the
  ladder `doc/DB_ARCHITECTURE.md:46` already commits to. Requires auditing for session-scoped
  state; `SET search_path` per checkout (removed in Phase 2) is precisely what would break under
  transaction pooling, which is why Phase 2 comes first.
- **LRU eviction + idle close** on the `pools` map, with an explicit cap and metrics.
- Attach the **Socket.IO Redis adapter** (S12) so realtime survives multi-replica.
- Give each BullMQ worker its **own** Redis connection (S11).
- Connection-budget observability: per-tenant in-use gauge, saturation alerting.

**Files.** `src/services/tenant/registry.service.js`, `src/realtime/index.js`,
`src/jobs/workers.js`, `src/config/redis.js`, `docker-compose.yml`, `doc/DEPLOYMENT.md`.

**Dependencies.** **Phase 2 is a hard prerequisite** — transaction pooling is unsafe while
session state is set per checkout.

**Deliverables.** PgBouncer in compose + deployment docs; bounded pool registry; multi-replica-safe
realtime; per-worker Redis connections; a documented, tested tenant-capacity number.

**Validation.**
- Re-run §1.4 — demonstrate **> 100 concurrently-active tenants** on one process.
- Two-replica soak test proving Smart Comms delivers to clients on **both** replicas
  (this fails today).
- Kill-one-replica test: no message loss, no connection leak.
- Sustained 1-hour soak with RSS and `pg_stat_activity` tracked — proves S10/S1 leak fixes.

---

### Phase 4 — Write path and worker efficiency

**Objective.** Make writes and background work cheap now that reads and connections are fixed.

**Scope.**
- **B6** (batched notification fan-out) — *if signed off*; otherwise parallelise the loop with a
  bounded concurrency and move it **out** of the business transaction via the outbox that
  `event_log` already provides.
- Puppeteer **browser pool** with page reuse and a hard render timeout (S13).
- Collapse the `emitEvent` chain into fewer statements where semantics allow (S6).
- Replace the 50 duplicated `update()` builders with `query-helpers.updateOne` (S19).
- Harden `query-helpers` with a per-table column allowlist (S20 defence-in-depth).

**Files.** `src/shared/notifications/notify-events.js`, `src/modules/notification/notification.service.js`,
`src/services/pdf.service.js`, `src/shared/events/emit.js`, `src/shared/db/query-helpers.js`, 50 `*.repo.js`.

**Dependencies.** Phase 2 (transaction/connection semantics settled).

**Deliverables.** Bounded-concurrency fan-out; pooled PDF renderer; one shared update builder;
identifier allowlisting.

**Validation.**
- Write-path round-trip count before/after for `POST /leads` with 50 notification recipients —
  target **≥ 10× reduction**.
- PDF p95 render latency and worker RSS before/after; assert no Chromium process leak over 500
  sequential renders.
- Byte-identical response assertions on all touched write endpoints.

---

### Phase 5 — Frontend load and render

**Objective.** Cut first-load bytes and eliminate the render cascade. Sequenced last because it
is independently deployable and the backend risks are existential while these are experiential.

**Scope.**
- **B1** (route-level `React.lazy`) — *if signed off*. Fix the 9 circular-chunk warnings so
  chunks are independently loadable.
- **B2** (`dashboard-mock` removal) — *pending the product answer*.
- Memoize both context provider values; wrap the six auth handlers in `useCallback` (S14).
- Introduce request caching + dedup + `AbortController` behind the existing `useList`/`useResource`
  signatures, so the 150+ call sites are untouched (S15).
- Self-host fonts to remove the render-blocking third-party stylesheet (S8).
- Apply `React.memo` to list-row and table components identified by an actual profiler run.
- Add code splitting to `platform-console` (currently one 232 kB chunk).

**Files.** `client/src/app/app.tsx`, `client/vite.config.ts`, `client/index.html`,
`client/src/app/auth/auth-context.tsx`, `client/src/app/branding/branding-context.tsx`,
`client/src/lib/use-resource.ts`, `platform-console/vite.config.ts`.

**Dependencies.** None technically — but **B1/B2 sign-off is blocking**, and the backend should
be stable so frontend measurements are not confounded.

**Deliverables.** Lazy-loaded routes; memoized providers; caching data layer behind unchanged
hook signatures; self-hosted fonts.

**Validation.**
- Bundle diff vs the §1.7 baseline — target **first-load gzip JS from 365.3 KB to ≤ 120 KB**.
- **A real Lighthouse run** (FCP/LCP/TBT) before and after — this audit could not run one (§0.1),
  and Phase 5 should not be accepted without it.
- **React DevTools Profiler** traces before/after on the heaviest screens
  (`features/sales/pages.tsx`, 2,591 LOC, 21 fetch call sites) — again, not available to this
  audit; must be captured for real.
- Network-panel assertion: navigating away and back issues **zero** duplicate requests.

---

## 6. Summary

| Severity | Count | Headline |
|---|---|---|
| Critical | 3 | 12-tenant ceiling; 7 round-trips/request; 123 unindexed sort columns |
| High | 6 | Uncached recursive CTE; notification N+1; write-path chain; no compression; whole-app eager load; global cache flush |
| Medium | 9 | Unbounded host cache; shared worker Redis; no Socket.IO adapter; Chromium per PDF; context re-renders; no client cache; ILIKE scans; OFFSET paging; no rate limit |
| Low | 2 | 50 duplicated builders; unenforced SQL identifiers |

The two facts that matter most:

1. **The product cannot onboard past ~12 concurrently-active tenants per API process, and adding
   API replicas makes that worse** (S1, measured). Everything else is optimisation; this is a
   ceiling.
2. **Roughly 5.5× of single-request latency is recoverable from additive indexes alone** (§1.2,
   measured), with no behaviour change and no architectural risk.

Phase 1 is safe to start immediately on approval. Phases 2–3 are the ones that decide whether
this scales, and Phase 3 depends on Phase 2 for correctness, not just convenience.

**No code has been changed. Awaiting review.**
