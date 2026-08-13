# Observability & Incident-Readiness Audit — 2026-08-04

**Scope:** logging, error tracking, metrics, alerting, tracing, incident response, as
visible in the repo and its configuration.
**Phase 0 — audit only.** No logging, monitoring, or alerting code was changed. The
roadmap in §8 is a proposal awaiting review.

**The test applied:** _if this breaks in production at 02:00, does anyone find out, and
can they fix it fast?_

**The answer:** No, and no. Today the only detection mechanism for every failure mode in
this system is **a user noticing and complaining during business hours**. There is no
alerting, no error tracking, no metrics, and the health check is incapable of reporting
failure — verified empirically, not inferred (§3, A2).

---

## 1. What already exists (credit where due)

This is not a codebase with no logging discipline. It has real foundations, which is why
the remediation below is mostly _wiring_, not _building_:

| Asset                                                              | Where                                                                                   | Why it matters                                                           |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Structured JSON logging (Pino), env-aware, ISO timestamps          | `src/config/logger.js`                                                                  | Machine-parseable from day one — no regex log-scraping                   |
| A redaction list                                                   | `logger.js:21-35`                                                                       | The instinct is right; the list is incomplete (§2, L4)                   |
| Request-ID generation + echo                                       | `src/middleware/request-id.js`                                                          | The correlation primitive already exists — it just goes nowhere (§5, E3) |
| Ambient tenant/user context (AsyncLocalStorage)                    | `src/config/request-context.js`                                                         | The enrichment data for every log line is _already in scope_, unused     |
| Centralised error handler, no leakage of SQL/stacks to clients     | `src/middleware/error-handler.js`                                                       | Consistent shape `{error:{code,message},request_id}`                     |
| Append-only audit ledger with DB-level immutability trigger        | `migrations/tenant/0130_platform_projection.sql:41-58`, `src/shared/events/emit.js:169` | A real compliance trail that genuinely writes                            |
| Durable outbox with retry + dead-letter states                     | `src/orchestration/dispatcher.js`                                                       | The mechanism exists; nothing watches the dead letters (§3, A6)          |
| Near-zero `console.*` usage — 2 occurrences, both in `env.js` boot | `src/`                                                                                  | Logging goes through one path. Rare and valuable.                        |
| Slow-query detection                                               | `src/config/database.js:104,132`                                                        | A signal exists, it's just not measured (§4, M3)                         |
| Solid CI gate (syntax, lint, 80 tests, secret scan, docker build)  | `.github/workflows/ci.yaml`                                                             | Good pre-production discipline                                           |

**The gap is not code quality. It is that nothing in production is watched.**

---

## 2. Logging quality

### L1 — No HTTP access log exists at all · **Critical** · Quick win

`pino-http@10.3.0` is a declared dependency (`package.json:64`) and is **mounted
nowhere**. `server.js:94` mounts only `requestIdMiddleware`.

Verified: two requests through the real app produced zero access-log lines.

There is no record of which endpoints were called, by whom, with what status, or how
long they took. You cannot answer _"was the API receiving traffic at 02:00?"_, _"which
endpoint started 500ing?"_, or _"when did latency change?"_ — not slowly, but **at all**.
This is the single largest logging gap and among the cheapest to close.

### L2 — The money path is entirely log-silent · **Critical** · Medium effort

**Zero `logger.*` calls** across all of `src/modules/finance/**` (journal_entry,
final_invoice, credit_note, debt, smart_receivables, tax_declaration,
financial_statement, asset, proforma) **and** `src/services/accounting/**`.

A journal posting, an invoice issuance, a credit note, a tax declaration — none emit a
single line. Overall only **43 of 857 source files (5%)** import the logger.

For an OHADA-accounting ERP, the paths where silent failure is most expensive are
precisely the paths with no logging.

### L3 — Almost no log line carries tenant or user · **Critical** · Quick win

This is a multi-tenant ERP with one database per tenant. Of ~120 log call sites, **none
include a tenant identifier**; a handful include `user_id`. Even the error handler
(`error-handler.js:39,67`) logs only `request_id`.

An error spike therefore cannot distinguish _"one tenant is broken"_ from _"everyone is
broken"_ — the first question anyone asks. The fix is unusually cheap because
`request-context.js` already carries `{tenant, userId}` in AsyncLocalStorage for RLS;
the logger simply never reads it.

### L4 — Sensitive data leaking into logs · **High** · Quick win

The redact list (`logger.js:21-35`) covers `password`/`token`/`secret`/`api_key`/
`bank_account_number`/`pin`. It misses:

| Leak                                | Location                                                                                           | Content                                                                                                                                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw email address                   | `src/modules/portal_auth/portal_auth.service.js:196`                                               | `logger.error({ email: normalized })`                                                                                                                                                                   |
| Admin email + role                  | `src/services/platform/provisioning.service.js:418`                                                | `logger.info({ slug, email, role })`                                                                                                                                                                    |
| Customer address strings            | `src/services/geoapify.service.js:116`, `src/modules/operations/geo_place/geo_place.service.js:90` | `place: text` / `place: original`                                                                                                                                                                       |
| **Row values via pg error objects** | `src/config/database.js:109,142`; `src/middleware/error-handler.js:67`                             | `logger.error({ err, sql })` — Pino's std serializer emits enumerable own props, and a pg unique-violation carries `detail` = `Key (email)=(x@y.com) already exists`. **`err.detail` is not redacted.** |

Also note Pino's `*.password` wildcard matches exactly **one** intermediate level —
`req.body.user.password` is **not** redacted by the current patterns.

Any log-shipping added later would export these off-box, so this must be fixed _before_
Phase 2, not after.

### L5 — Level discipline inverted for real failures · **Medium** · Quick win

53 `warn` calls vs 23 `error`. The dominant idiom is
`logger.warn({ err: err.message }, "…failed")` — a caught-and-continued failure logged
below error level, with the **stack discarded**. Affected paths are not trivial:

- `costing.service.js:91` — costing-approval → draft-invoice sync failed
- `notification.service.js:63,78` — email / push delivery failed
- `notify-approvals.js:62,85` — approval notifications failed
- `dispatcher.js:92` — **orchestration handler failed** (see A6)
- `orchestrator.service.js:549` — AI usage/spend logging failed

Any alert keyed on `level >= error` would miss **every one of these**.

### L6 — The runbook documents a log location that does not exist · **Medium** · Quick win

`doc/DEPLOYMENT.md §7`: _"Logs — `docker compose logs -f api`/`worker`; **files also land
in `./logs`**."_

Nothing in the codebase ever writes to a file — Pino writes to stdout only (verified: no
`pino.destination`, no `createWriteStream`, no file transport anywhere). `./logs` is
mounted into all three containers and is gitignored, and stays permanently empty. An
on-call engineer following the runbook at 02:00 goes to an empty directory.

### L7 — Logs are neither durable nor shipped · **High** · Quick win (rotation) / Medium (shipping)

Logs go to stdout → docker's default `json-file` driver, with **no `logging:` block, no
`max-size`, no `max-file`** anywhere in `docker-compose.yml`. Two consequences:

1. **Unbounded growth → disk fill** on a single-VPS deployment. Disk is itself
   unmonitored, so this is a plausible _cause_ of the 02:00 outage — and it takes
   Postgres, Redis, api, standby, and worker down together.
2. **No aggregation, no retention.** Logs exist only on that one box and are lost when a
   container is recreated — which `scripts/deploy.sh` does on **every deploy**.
   Post-incident forensics after a deploy is impossible.

---

## 3. Error tracking

### E1 — No centralised error tracking of any kind · **Critical** · Medium effort

No Sentry, Rollbar, Bugsnag, OpenTelemetry, Datadog, or any APM — in dependencies, code,
or config. Every error terminates in a container's stdout on one VPS.

No deduplication, no grouping, no first-seen/regression detection, no notification.
**Nobody is watching.**

This is a known, documented requirement, not an oversight discovered here:
`doc/SmartLS_PRD_Master_Functional_Spec_v2.md:217` specifies _"Observability: centralised
structured logs, error tracking (e.g. Sentry), uptime + resource monitoring, and
audit/AI-call logs."_

### E2 — Frontend errors are completely invisible · **Critical** · Quick win

No `ErrorBoundary`, no `componentDidCatch`, no `window.onerror`, no `unhandledrejection`
handler anywhere in `client/src` or `platform-console/src`.

A render crash is a white screen with **zero telemetry**. Users are the only detector,
and "the page is blank" carries no diagnostic content.

### E3 — The correlation ID is minted, then thrown away · **High** · Quick win (client) / Medium (persistence)

`request-id.js` generates a UUID and echoes `X-Request-Id`; error responses even include
`reference: request_id` (`error-handler.js:69`). But:

- **The client discards it.** `client/src/lib/api-client.ts:142-143` constructs
  `ApiError{code, message, status, details}` — `reference`/`request_id` is dropped. The
  user can never quote it in a support ticket.
- **The client never sends one.** No `X-Request-Id` in any client request.
- **It is persisted in no database table.** Confirmed: `request_id` appears in **zero
  migrations**. `immutable_ledger` (`0130_platform_projection.sql:41-54`) records
  actor/action/module/entity_ref/before/after/ip/created_at — but **no request_id**.

So even a perfect audit-ledger row cannot be joined back to the log line, the error, or
the request that caused it. The primitive exists and connects nothing.

### E4 — `uncaughtException` keeps a poisoned process alive · **High** · Quick win

`server.js:207-212` (and `workers.js:114-115`) log and return — the process continues
in an undefined state, explicitly labelled _"(kept alive)"_.

After an uncaught exception, in-flight transaction and pool state are unknowable. A
crash-and-restart is both safer and — critically — **observable**. Combined with the
absence of any `restart:` policy (A4), this converts a loud, detectable crash into a
silent, ongoing corruption risk that nothing will ever report.

---

## 4. Alerting gaps — what must go wrong before a human finds out

### A1 — There is no alerting. At all. · **Critical** · Quick win

No alertmanager, no uptime monitor, no webhook, no PagerDuty, no email-on-error. No
nginx, Prometheus, or Grafana configuration exists in the repo.

**The detection path for every failure mode is a user complaining during business
hours.** For a 02:00 failure, MTTD is measured in **hours — until morning**.

### A2 — The health check is structurally incapable of failing · **Critical** · Quick win

`src/routes/index.js:18-20`:

```js
router.get("/health", (_req, res) =>
  res.json({ ok: true, ts: new Date().toISOString() }),
);
```

It checks nothing — not the pg pool, not Redis, not the tenant registry.

**Verified empirically.** With Postgres refusing connections (`ECONNREFUSED
127.0.0.1:5432` — the same request path returned a 500 from a real DB failure), the
health endpoint still returned:

```
GET /api/health  ->  200 {"ok":true,"ts":"2026-08-04T03:59:41.534Z"}
```

This endpoint is simultaneously:

- the **docker healthcheck** for `api` and `api-standby` (`docker-compose.yml`)
- the gate for **`docker compose up -d --wait`** in `scripts/deploy.sh`
- the **final smoke test** at the end of `scripts/deploy.sh`

A completely broken deploy — DB unreachable, Redis down — passes every one of those
gates and prints `deploy ✓`. Meanwhile nginx keeps routing traffic to a container that
cannot serve a single request.

**This is the highest-leverage fix in this report.**

### A3 — Redis outage boots silently degraded · **Critical** · Quick win

`server.js:218`:

```js
initRedis().catch((err) =>
  logger.warn(
    { err: err.message },
    "redis unavailable at boot — continuing without it",
  ),
);
```

The API starts, `/api/health` reports `ok:true`, and the following are all broken:
sessions/refresh tokens, remote session kill, rate limiting, the identity/permission
cache, socket.io pub/sub, **and all job enqueueing**.

One `warn` line. No alert. Users experience login failures and background work that
silently never happens.

### A4 — No `restart:` policy on any service · **High** · Quick win

`docker-compose.yml` sets `restart` on exactly one service: `migrate: restart: "no"`.
`api`, `api-standby`, `worker`, `postgres`, and `redis` have **none** → docker defaults
to `no`.

A container that exits (OOM kill, fatal error) **stays down**. A host reboot brings back
**nothing**. Nothing alerts. Combined with A2 (health cannot fail) and E4 (crashes
suppressed), the system has neither self-healing nor notification.

### A5 — The worker is entirely unmonitored · **High** · Quick win

The `worker` service has **no healthcheck** (api and api-standby do). Nothing tracks
queue depth, job age, or worker liveness.

If the worker dies or hangs, the symptom is **silence**: PDFs never render, emails never
send, FX never syncs, orchestration never dispatches, mail never syncs. Every failure is
failure-_by-absence_ — precisely the class of failure nobody notices until a customer
asks where their invoice went.

### A6 — Dead-lettered business events are a silent black hole · **Critical** · Medium effort

`dispatcher.js:44-51` marks an event `DEAD` after 5 attempts and stores `last_error` in
`event_dispatch`. But:

- The log line (`dispatcher.js:92`) is **`warn`**, and is **byte-identical for a
  retriable `FAILED` and a terminal `DEAD`** — there is no way to alert on _"gave up
  permanently."_
- **Nothing ever queries `event_dispatch WHERE status='DEAD'`.**

The handlers that die here are the cross-module money flows:
`costing-approved-draft-invoice`, `supplier-invoice-posted-cost-entry`,
`receipt-posted-collected-signal`.

Concretely: an approved costing that should generate a draft invoice **simply never
generates one — permanently, with no error visible to any human**. The app is up,
returning 200s, and quietly not doing the thing it was asked to do. This is the exact
silent-failure-in-a-money-path scenario the audit was asked to prioritise.

### A7 — Failed BullMQ jobs accumulate unwatched · **Medium** · Medium effort

`queue-producer.js` sets `attempts:3`, `removeOnFail:5000`. `workers.js:59` logs each
failure at `error` — but nothing aggregates them, and BullMQ's `failed` event fires **per
attempt**, so a transient blip and a permanent failure look identical in the logs. No
alert on failed-count, and none on a queue that has stopped draining.

---

## 5. Metrics & dashboards

### M1 — No metrics of any kind · **Critical** · Medium effort

No `/metrics` endpoint, no `prom-client`, no statsd, no dashboard. Not tracked:

request rate · error rate · latency (p50/p95/p99) · 5xx count · queue depth & age · job
failure rate · DB pool saturation/wait · Redis liveness · `event_dispatch` DEAD count ·
login failure rate · AI spend vs `AI_MONTHLY_CAP_XAF` · per-tenant activity · disk/CPU/memory

There is no historical data, therefore **no baseline**. Even after an incident, nobody
can say what "normal" looked like.

### M2 — Business metrics are unobservable, though the data already exists · **High** · Medium effort

The database already holds everything needed: `immutable_ledger`, `event_log`,
`event_dispatch`, `journal_entry`, `final_invoice`, `approval_task`. Nothing surfaces
_invoices posted per hour_, _approvals stuck pending_, _DEAD events_, _failed
deliveries_.

These are the metrics that catch a **business-logic** failure — where the app is up,
returns 200, and is silently doing nothing or the wrong thing. Given A6, this is the
failure class this system is **most exposed to and least equipped to see**.

### M3 — Slow queries warn but are never measured · **Medium** · Quick win

`database.js:104-106,132-134` warns above a hardcoded 500 ms. That is a log line, not a
metric: no percentiles, no top-N, no trend, and the threshold is not configurable. With
`DB_STATEMENT_TIMEOUT_MS` at 30 s, a query can burn 29.9 s and produce a single `warn`
lost among thousands.

---

## 6. Tracing & debuggability

### T1 — Reconstructing one failed request is effectively impossible · **Critical** · (resolved by Phases 2+4)

Walk the real path. A user reports _"posting an invoice failed this morning."_

| Step                                  | Blocked by                                    |
| ------------------------------------- | --------------------------------------------- |
| 1. Find the request                   | No access log — L1                            |
| 2. Ask the user for a reference       | Client discarded it — E3                      |
| 3. Filter logs to that tenant/user    | No tenant/user on log lines — L3              |
| 4. See how far the posting got        | Finance code logs nothing — L2                |
| 5. Join the ledger row to the request | Ledger has no `request_id` — E3               |
| 6. Read logs from that time           | Container recreated on deploy; logs gone — L7 |

What remains is `docker compose logs api \| grep -i error` and guesswork.

### T2 — No timing recorded anywhere · **High** · Quick win

No request duration, no handler duration, no job duration — `workers.js:52-55` logs
`job start` and `job done` but never computes elapsed time. _"Is it slow or is it hung?"_
is unanswerable.

### T3 — No cross-process correlation · **Medium** · Medium effort

The chain API → BullMQ → worker → orchestration handler carries no trace identity: job
payloads contain no request_id, and workers run outside the AsyncLocalStorage context. A
failed job cannot be traced back to the user action that enqueued it.

### T4 — Auth, RBAC and tenant middleware log nothing · **High** · Quick win

**Zero `logger.*` calls** in `auth.js`, `rbac.js`, `tenant-context.js`,
`host-tenent-resolver.js`, `platform-auth.js`.

No failed-login record, no permission-denial record, no tenant-resolution-failure record.
This is both a debugging gap (_"why is this user getting 403s?"_) and a security-detection
gap — credential stuffing against a multi-tenant ERP would be **entirely invisible**, and
rate limiting exists only on forgot/reset-password (`app_user.routes.js:20-21`).

---

## 7. Incident-response readiness

### I1 — No runbook, no on-call, no incident process · **Critical** · Process work

No document defines who is contacted, severity levels, escalation, or communications.
`doc/DEPLOYMENT.md §7` has genuinely useful operational notes and a troubleshooting
table — but it is a deployment guide, not an incident runbook, and one of its two
logging statements is factually wrong (L6).

### I2 — No rollback procedure and no artifact to roll back to · **Critical** · Medium effort

`scripts/deploy.sh` runs `git pull --ff-only` → `docker compose build` → migrate → roll
containers. Images are **built from source at deploy time and never tagged or retained**.

There is therefore **no previous artifact to roll back to.** Recovery means `git revert`
plus a full rebuild — minutes of compilation and image building, under incident pressure,
over SSH.

Compounding this: `deploy.yaml` auto-deploys on **every green CI run on main**, so a bad
merge reaches production automatically, with no manual gate and no fast undo.

### I3 — Migrations have no rollback path and run before the app rolls · **High** · Medium effort

`deploy.sh` runs `docker compose run --rm migrate` **before** restarting containers. The
convention is "keep them additive" (DEPLOYMENT.md), but nothing enforces it —
`check-migration-numbers.js` validates numbering collisions only.

A destructive migration that passes CI is applied to **every tenant database**, with no
down-migration and no automated pre-deploy backup. Backups are documented as a manual
`pg_dumpall` one-liner (§7) with **no schedule, no automation, and no restore drill**.

### I4 — The deploy has no real smoke test and no auto-rollback · **High** · Quick win

The final gate is `curl -fsS http://localhost:3000/api/health` — which, per A2, **cannot
fail**. And because `deploy.sh` uses `set -euo pipefail`, a genuine failure aborts
_mid-roll_, potentially leaving standby and primary on **different versions** with no
automatic revert.

### I5 — Deploys are unattributed and unannounced · **Medium** · Quick win

No deploy marker exists anywhere — nothing records _"version X went live at T"_. Because
deployment is `git pull`, the running version is simply whatever `HEAD` was. Correlating
_"errors started at 02:14"_ with _"a deploy happened at 02:10"_ requires SSH and
`git log`. No release tags, no `/version` endpoint.

### I6 — Single-host topology with no capacity signal · **High** · Deeper investment

Postgres, Redis, api, api-standby, and worker all run on **one VPS** via docker-compose.
`api-standby` protects only against the primary restarting — it shares the same Postgres,
the same Redis, the same host, and the same disk. There is no disk, CPU, or memory
monitoring.

The most likely real 02:00 outage — **disk full from unrotated docker logs (L7)** — takes
down every component simultaneously, with no alert and no automatic restart (A4).

---

## 7b. Configuration drift found along the way

Not observability gaps as such, but each one misleads an incident responder:

| Item                      | Finding                                                                                                                                                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/middleware/audit.js` | **Dead code — imported by zero files.** The `audit()` used across services is a different helper (`src/shared/events/emit.js:169` → `immutable_ledger`), with a different signature. The real audit trail _does_ work; this file misleads a reader into thinking `shared.audit_log` is populated. It is not. |
| `ENABLE_AUDIT_LOG`        | Gates `middleware/audit.js:57` but is **absent from the Zod schema** in `env.js`, which strips unknown keys. Verified: `config.ENABLE_AUDIT_LOG` is `undefined` **even when the env var is explicitly set to `true`**. The gate can never open. Harmless only because the file is dead.                      |
| `ENABLE_WORKERS`          | Set to `"false"` for `api`/`api-standby` in `docker-compose.yml`, but **read by no code** (only referenced in a comment in `jobs/corn-lock.js:5`). An operator would reasonably believe it controls something.                                                                                               |
| `ecosystem.config.js`     | **0 bytes.** A PM2 config that is empty and unused.                                                                                                                                                                                                                                                          |
| `doc/DEPLOYMENT.md §7`    | States log files land in `./logs`. They do not (L6).                                                                                                                                                                                                                                                         |

These are cheap to clean up and each one costs an incident responder time at exactly the
wrong moment.

---

## 8. Proposed 5-phase remediation roadmap

Sequenced by _"what shortens time-to-detection the most, per unit of effort"_ — not by
tidiness. Phase 1 alone moves MTTD from **hours** to **minutes**.

Scaled to this team: one VPS, docker-compose, a small team. Recommendations favour
managed free/cheap tiers and existing dependencies over a self-hosted observability
platform, which would add a system that itself needs monitoring.

**Constraint honoured throughout: observability additions must not change application
behaviour.** Per-phase performance tradeoffs are called out explicitly.

---

### Phase 1 — Make failure _detectable_ (the 2am problem)

**Dependencies:** none. Start here.
**Effort:** ~1–2 days. Almost entirely configuration.

**Scope:** stop the bleeding. Nothing here changes application logic; it changes what the
platform reports about itself.

**Deliverables**

1. **Real health endpoints** (`src/routes/index.js`), replacing the unconditional stub:
   - `GET /api/health/live` — process is up, **no dependency checks** (for restart policies).
   - `GET /api/health/ready` — `SELECT 1` on the pg pool (≤2 s timeout), Redis `PING`,
     tenant-registry reachable. Returns **503** with a per-dependency breakdown when any
     fails.
   - Keep `GET /api/health` as an alias of `/live` so nothing existing breaks.
2. **Repoint the gates**: docker healthchecks for `api`/`api-standby` → `/ready`;
   `deploy.sh` final smoke test → `/ready`.
3. **`restart: unless-stopped`** on `api`, `api-standby`, `worker`, `postgres`, `redis`.
4. **Worker liveness**: a healthcheck plus a Redis heartbeat key refreshed each tick, so
   "worker alive" is externally checkable.
5. **Log rotation** on every service: `logging: driver: json-file, options: {max-size: 50m, max-file: 5}`.
6. **External uptime monitoring** — UptimeRobot / BetterStack free tier polling
   `/api/health/ready` every 60 s from outside the host, alerting to email + SMS.
   _This single item is what converts "hours until morning" into "under 5 minutes"._
7. **Disk/CPU/memory alert** on the VPS (provider-native, or the same uptime tool) —
   disk > 80%.
8. **Let crashes be crashes**: remove the `uncaughtException` keep-alive (`server.js:210`,
   `workers.js:115`), now safe because of item 3. Keep `unhandledRejection` logging.
9. Fix the `./logs` claim in `doc/DEPLOYMENT.md`; delete the empty `ecosystem.config.js`
   and the dead `src/middleware/audit.js`.

**Tradeoff to flag:** making `/ready` fail on Redis is deliberate — A3 shows a
Redis-less boot is badly degraded, so it _should_ be reported unhealthy. Because
`api-standby` is `backup` in nginx, both going unready simultaneously means an outage is
correctly surfaced rather than hidden. If the team prefers availability over
correctness here, downgrade Redis to a warning field in the body while keeping the
Postgres check hard-failing — but make that an explicit choice.

**Validation**

- `docker compose stop postgres` → `/api/health/ready` returns 503 within 5 s; the
  external monitor alerts within 60 s. **This is the test that fails today.**
- `docker compose stop redis` → 503, alert fires, `/live` stays 200.
- `docker kill praxis_worker` → container restarts automatically; if it stays down, the
  heartbeat alert fires.
- Write 1 GB of log output → confirm rotation caps at 250 MB/service.
- Reboot the host → every service returns unaided.

---

### Phase 2 — Centralised error tracking + request context

**Dependencies:** Phase 1 (an alert channel must exist to route errors to).
**Effort:** ~3–5 days.

**Scope:** every error reaches one place, already carrying the context needed to act on
it. **L4 must be fixed first** — this phase ships logs off-box, so leaking fields must be
redacted before, not after.

**Deliverables**

1. **Extend redaction** (`logger.js`) _first_: `err.detail`, `err.where`, `err.table`,
   `*.email`, `*.place`, `*.address`, plus deeper nesting (`*.*.password`). Add a unit
   test asserting a pg unique-violation error does not serialise its `detail`.
2. **Mount `pino-http`** (already a dependency) with: `request_id`, method, **route
   pattern** (not raw URL — avoids IDs/PII in log keys), status, duration.
   `autoLogging.ignore` for `/api/health*` and `/media/*`.
3. **Context-bound child logger**: extend `request-context.js` to carry `request_id`
   alongside the existing `{tenant, userId}`, and add a `getLogger()` that returns a
   Pino child bound to those fields, falling back to the base logger outside a request.
   Closes L3 across all 857 files without touching them individually.
4. **Error tracking** — Sentry (or self-hosted GlitchTip if cost-sensitive) for the API,
   `client`, and `platform-console`. Tag every event with `tenant`, `user_id`,
   `request_id`, release SHA. `beforeSend` scrubbing mirroring the Pino redact list.
5. **Frontend error capture**: an `ErrorBoundary` at the app root plus a
   `window.unhandledrejection` handler in both frontends — closes E2.
6. **Preserve the correlation ID client-side**: add `reference` to `ApiError`
   (`api-client.ts:142`), display it in the error toast, and send `X-Request-Id` on
   outbound requests so the ID originates at the browser.
7. **Raise levels on swallowed failures** (L5): the paths listed in L5 move `warn` →
   `error` and log the full error, not `err.message`.

**Tradeoff to flag:** `pino-http` adds a small per-request serialisation cost. Mitigated
by ignoring health/media and keeping the serializer minimal. If request volume later
makes 2xx logging expensive, sample successes and keep 100% of 4xx/5xx — but do **not**
sample errors.

**Validation**

- Trigger a deliberate error on a staging route → it appears in Sentry within seconds,
  tagged with the correct tenant, user, and request_id.
- Take one `request_id` and trace it end-to-end: access log → error log → Sentry event →
  the `reference` shown in the browser.
- Force a duplicate-key insert → confirm the Sentry event and log line contain **no** row
  values from `err.detail`.
- Throw inside a React render → the boundary catches it and the event reaches Sentry.

---

### Phase 3 — Metrics, dashboards, and alerts that fire on business failure

**Dependencies:** Phase 2 (shared context/labels).
**Effort:** ~1 week.

**Scope:** know what "normal" is, and get alerted when it isn't — including when the app
is _up and silently doing nothing_ (A6, M2).

**Deliverables**

1. **`/metrics`** via `prom-client`, bound to loopback or behind platform auth — **never
   public** (it leaks tenant/route topology).
2. **System metrics:** `http_requests_total{route,status}`,
   `http_request_duration_seconds` (histogram), pg pool total/idle/**waiting**, Redis up,
   event-loop lag, RSS.
3. **Queue metrics:** per-queue depth / active / failed / delayed, job duration histogram,
   **oldest-waiting-job age** (the metric that catches a wedged worker).
4. **Business metrics** — the ones that catch silent failure:
   - `event_dispatch` rows with `status='DEAD'` (**any non-zero value is an alert** — A6)
   - approvals pending beyond N hours
   - journal postings / invoices posted per hour (alert on _drop to zero_ during business hours)
   - login failure rate (also the missing security signal — T4)
   - AI spend against `AI_MONTHLY_CAP_XAF`
5. **Dashboards** — Grafana Cloud free tier preferred over self-hosting, so the
   monitoring system does not share the failure domain it monitors.
6. **Alert rules**, each routed to the Phase 1 channel: 5xx rate > 2% over 5 min; p95
   latency > 2 s; `/ready` failing; queue depth growing 15 min or oldest job > 15 min;
   **any DEAD event**; worker heartbeat stale > 5 min; disk > 80%; login failure spike.
7. **Make the slow-query threshold configurable** (`SLOW_QUERY_MS`, default 500) and emit
   it as a histogram rather than only a log line (M3).

**Tradeoff to flag:** the business metrics in item 4 are SQL aggregates against tenant
databases. Run them on a **fixed interval (30–60 s) from the worker**, not per scrape and
never per request — an unbounded per-scrape query across every tenant DB is exactly the
"verbose work in a hot path" the constraint warns about. Each must be indexed and bounded
by a time window.

**Validation** — every alert is tested by **causing the failure it is meant to catch**:

- Stop the worker → queue-depth and heartbeat alerts fire.
- Force an orchestration handler to throw 5× → the event goes DEAD → alert fires.
  _This is the A6 scenario and the most important test in this phase._
- Load-generate 500s → 5xx-rate alert fires.
- Add an artificial 3 s delay on a staging route → latency alert fires.
- Confirm each alert **resolves** when the fault is cleared (no stuck alerts).

---

### Phase 4 — Trace a single transaction end-to-end

**Dependencies:** Phases 2 and 3.
**Effort:** ~1 week.

**Scope:** make T1 answerable — from a customer complaint to the exact request, in
minutes, without SSH.

**Deliverables**

1. **Persist the correlation ID**: additive, nullable `request_id` columns on
   `immutable_ledger` and `event_log` (backward-compatible; no behaviour change),
   populated from the request context. Closes the E3 join gap.
2. **Propagate context into jobs**: include `request_id` (and `tenant`) in every BullMQ
   job payload, and re-establish the AsyncLocalStorage context inside the worker so job
   logs carry the originating request's ID. Closes T3.
3. **Structured logging on the money path** (L2) — `src/modules/finance/**` and
   `src/services/accounting/**`: **one `info` line per business outcome** (journal posted,
   invoice issued, credit note raised, receipt posted, approval transitioned) carrying
   tenant, actor, entity_ref, amount, currency, request_id.
4. **Job timing** (T2): duration on `job done`/`job failed` in `workers.js`.
5. **Auth/RBAC/tenant logging** (T4): failed logins, permission denials, and
   tenant-resolution failures — with tenant, user (or attempted identifier), IP, and
   request_id. Feeds the Phase 3 login-failure metric.

**Tradeoff to flag — the important one in this roadmap:** item 3 is deliberately **one
line per business outcome, not per row or per loop iteration**. Invoice and journal
posting are hot paths on batch operations; per-line logging would materially affect
throughput and flood storage. Amounts and entity references are business data, not
secrets, but they **must not** include client names, addresses, or bank details — log
`entity_ref` IDs and let the reader resolve them. Item 5 must log the _attempted_
identifier without ever logging the submitted password or token.

**Validation**

- Pick a deliberately failed invoice post in staging. Starting **only** from the
  `immutable_ledger` row, retrieve: the `request_id` → the access-log line → the error
  log → the Sentry event → any job it enqueued. **Target: under 2 minutes, no SSH.**
- Enqueue a job from a request, force it to fail in the worker, and confirm the job's
  error log carries the originating HTTP request's `request_id`.
- Verify a batch invoice post produces O(1) log lines, not O(line items).

---

### Phase 5 — Incident process, safe rollback, and drills

**Dependencies:** Phases 1–3 (alerts must exist before runbooks can reference them).
**Effort:** ~1 week, mostly process rather than code.

**Scope:** close I1–I6 — detection is useless without a fast, rehearsed recovery path.

**Deliverables**

1. **Tag and retain images**: build as `praxis-ls:<git-sha>`, push to a registry, deploy
   by tag. **Rollback becomes `deploy.sh --tag <previous-sha>` — seconds, not a rebuild.**
   This is the single highest-value item in this phase (I2).
2. **`GET /api/version`** returning git SHA + build time; send deploy markers to Sentry
   and Grafana annotations so "errors started at 02:14 / deploy at 02:10" is visible on
   the same chart (I5).
3. **Automated pre-deploy backup**: `pg_dump` of platform + all tenant DBs, with retention
   — plus a **scheduled restore drill**, because an untested backup is not a backup (I3).
4. **`doc/RUNBOOK.md`** — one section per alert configured in Phase 3: what it means, the
   first three checks, the rollback command, escalation. Written against the alerts that
   actually exist, not generic advice (I1).
5. **On-call**: even a two-person rotation, with one documented alert channel and an
   escalation path (I1).
6. **Post-incident template** plus a standing review.
7. **Migration safety** (I3): a CI check flagging `DROP` / destructive `ALTER` in
   migrations, requiring either a documented down-path or an explicit
   "irreversible — backup verified" sign-off in the PR.
8. **Consider a manual approval gate** on `deploy.yaml` for production, given auto-deploy
   on every green main build with no fast undo (I2).

**Validation — a scheduled game day:**

- **Roll production back to the previous tag and time it. Target: under 2 minutes.**
- Restore the most recent backup into a scratch database; verify row counts against
  production.
- Page the on-call through the real channel; measure acknowledgement time.
- Run one simulated incident end-to-end (detect → diagnose → roll back → write up) and
  measure MTTD and MTTR against the pre-Phase-1 baseline of "until someone complains."

---

## 9. Summary

| #   | Finding                                                 | Severity | Effort       |
| --- | ------------------------------------------------------- | -------- | ------------ |
| A2  | Health check cannot fail — **verified with DB down**    | Critical | Quick win    |
| A1  | No alerting of any kind                                 | Critical | Quick win    |
| A3  | Redis outage boots silently degraded                    | Critical | Quick win    |
| A6  | Dead-lettered money-path events are a silent black hole | Critical | Medium       |
| E1  | No centralised error tracking                           | Critical | Medium       |
| E2  | Frontend errors entirely invisible                      | Critical | Quick win    |
| L1  | No HTTP access log at all                               | Critical | Quick win    |
| L2  | Finance/accounting layer is log-silent                  | Critical | Medium       |
| L3  | No tenant/user on log lines                             | Critical | Quick win    |
| M1  | No metrics, no dashboard, no baseline                   | Critical | Medium       |
| T1  | Cannot reconstruct a single failed request              | Critical | Phases 2+4   |
| I1  | No runbook, on-call, or incident process                | Critical | Process      |
| I2  | No rollback path — no artifact to roll back to          | Critical | Medium       |
| A4  | No `restart:` policy on any service                     | High     | Quick win    |
| A5  | Worker entirely unmonitored                             | High     | Quick win    |
| E3  | Correlation ID minted then discarded; persisted nowhere | High     | Quick/Medium |
| E4  | `uncaughtException` keeps a poisoned process alive      | High     | Quick win    |
| L4  | PII + pg `err.detail` leaking into logs                 | High     | Quick win    |
| L7  | Logs unrotated, unshipped, lost on every deploy         | High     | Quick win    |
| M2  | Business metrics unobservable though data exists        | High     | Medium       |
| T2  | No timing recorded anywhere                             | High     | Quick win    |
| T4  | Auth/RBAC/tenant middleware log nothing                 | High     | Quick win    |
| I3  | Migrations: no rollback, no automated backup            | High     | Medium       |
| I4  | Deploy smoke test cannot fail; no auto-rollback         | High     | Quick win    |
| I6  | Single-host SPOF, no capacity signal                    | High     | Deeper       |
| A7  | Failed jobs accumulate unwatched                        | Medium   | Medium       |
| L5  | Real failures logged at `warn`, stacks discarded        | Medium   | Quick win    |
| L6  | Runbook documents a log path that does not exist        | Medium   | Quick win    |
| M3  | Slow queries warned but never measured                  | Medium   | Quick win    |
| T3  | No cross-process correlation into workers               | Medium   | Medium       |
| I5  | Deploys unattributed and unannounced                    | Medium   | Quick win    |

**14 of the 31 findings are quick wins**, and they include the highest-severity items
(A1, A2, A3, L1, L3, E2). Phase 1 is roughly one to two days of mostly configuration work
and takes MTTD from _hours_ to _minutes_.

**If only one thing is done: fix the health check (A2) and put an external uptime monitor
on it.** Everything else in this report assumes someone finds out.

---

_Phase 0 audit — no application behaviour was modified. Awaiting review before any
implementation._
