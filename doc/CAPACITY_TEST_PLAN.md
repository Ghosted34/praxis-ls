# Praxis LS — Capacity Test Plan (WS-S1 verification)

**Status:** Proposal for review. No test has been run; this document says how to run one.
**Owner:** JBS Praxis engineering.
**Closes:** the verification line of `INFRASTRUCTURE_PLAN.md` §5 WS-S1 — "demonstrates **>100 concurrently-active tenants** on one API process, and a two-replica soak holds connections flat."

---

## 1. Why this document exists

The ">100 concurrently-active tenants" figure appears in `INFRASTRUCTURE_PLAN.md` and in the
superseded `PERF_ARCHITECTURE_AUDIT_2026-08-04.md`. It has never been measured. It is an
assumption that has been quoted often enough to read like a result, which is the most expensive
kind of number to have in a plan: it is load-bearing for the scaling story and nobody can say what
happens at 101.

A capacity test is cheap while the answer can still change the architecture and expensive once
growth has made the answer urgent. That is the entire argument for doing it now.

---

## 2. The sequencing problem — read this before scheduling anything

**Running the test today would measure the wrong system.** The 100-tenant claim describes Praxis
*behind PgBouncer*. Today the pooler is deployed but carries no traffic, so a test run now
measures the direct-to-Postgres path — a different ceiling, governed by a different constraint,
and one nobody is proposing to ship at scale.

Four steps, in this order. Steps 1–2 are not test setup; they are the cutover the test exists to
validate.

| # | Step | Why it must come first |
|---|---|---|
| 1 | **Backfill per-tenant DB credentials (WS-S2)** — `scripts/db/tenant-credentials.js` per tenant | Built but inert: `db-credential.service.js` resolves vault → shared fallback, so an un-rotated tenant still uses the shared password. D3's sign-off note is explicit that the pooler must authenticate against the per-tenant roles, so S2 lands first or PgBouncer's `auth_query` is configured for roles that do not exist yet. |
| 2 | **Cut over to PgBouncer** — set `TENANT_DB_POOLER_HOST` **and** `TENANT_DB_POOLER_PORT` together | Nothing routes through the pooler until this is set. **Both, or neither** — `registry.service.js` documents the 2026-08-12 incident where a port with an empty host sent every tenant connection to the real Postgres host on 6432. |
| 3 | **Confirm pooler telemetry is arriving** — `tenant_health.pooler_*` non-NULL | Added in migration `0100`. NULL means the collector cannot read the admin console, and a capacity test with no view of the pooler's own queue measures the app side only — the exact blindness the migration exists to remove. |
| 4 | **Run the test below** | Now it measures the architecture the number describes. |

A useful intermediate: run the harness **once before step 2** and once after. The
before-run is not the answer, but it is a free baseline, and the delta is the clearest
evidence that the pooler did what D3 approved it for.

---

## 3. What "concurrently-active tenant" has to mean

The claim is meaningless without a definition, and the loosest reading passes trivially. A tenant
counts as concurrently active only if, **within the same measurement window**, it:

1. holds at least one authenticated session,
2. issues a request that reaches its own database (not a cached read, not a 404), and
3. does so often enough to keep a pooled connection warm — `TENANT_POOL_IDLE_MS` defaults to
   10s, so slower than roughly one request per 10s per tenant is *not* concurrency, it is
   sequential traffic wearing a costume.

**Why this matters:** 100 tenants pinging `/api/health/ready` proves nothing — that path
deliberately holds no tenant connection. The test has to exercise the real request path:
host resolution → credential resolution → pool checkout → `search_path` → a query → release.

---

## 4. Test design

### 4.1 Fixture — 120 tenants

Provision **120**, not 100: the target must be exceeded for the result to be a ceiling rather
than a coincidence, and headroom lets the test find where it actually breaks.

```bash
for i in $(seq 1 120); do
  node scripts/db/provision-tenant.js --slug="captest$i" --name="Cap Test $i"
  node scripts/db/tenant-credentials.js --slug="captest$i" --rotate   # WS-S2, step 1 above
done
```

Use a **dedicated database host**, not staging-shared. 120 tenant databases plus their pools
against a `max_connections` someone else is also spending is a test of the neighbours, not of
Praxis.

### 4.2 Load profile

The realistic shape, and it is deliberately not a flat rate:

- **80 tenants at low rate** (~1 req/s) — the long tail that keeps connections warm without
  consuming them. This is where the pool *cache* is tested (`TENANT_POOL_CACHE_MAX`, default 24 —
  note that is far below 120, so eviction is under test whether or not anyone intended it).
- **30 tenants at moderate rate** (~10 req/s) — ordinary working tenants.
- **10 tenants at high rate** (~50 req/s) — the noisy neighbours whose blast radius
  `rate-limit.js` is supposed to bound.

Mix of endpoints, weighted toward reads, including at least one write path so transaction
handling under the pooler is exercised — a transaction pooler's failure modes are invisible to a
read-only test.

### 4.3 Harness

`autocannon` or `k6`. **Drive it from a separate machine.** A load generator sharing a host with
the API competes for the CPU it is measuring, and the result is a number about the test rig.

Each virtual user must send its tenant's `Host` header (or `X-Praxis-Tenant`), because tenant
resolution is part of what is being measured. A single Host header across 120 workers tests one
tenant 120 times.

Suggested home: `scripts/ops/capacity-test.js`, next to `tenant-smoke.js` and
`uptime-probe.js`, which already own the "runs against a deployment from outside" role.

### 4.4 Duration

- **Ramp** 5 min → **steady state 30 min** → observe 5 min after load stops.
- Thirty minutes because the failure modes here are slow: pool cache thrash, connection leaks and
  PgBouncer `server_lifetime` recycling (3600s) do not appear in a 60-second burst. A short test
  reliably produces a pass and tells you nothing.
- The post-load window is where a **leak** shows: connections must return to baseline. They
  either do or they do not, and that is the single cleanest signal in the whole exercise.

---

## 5. Pass criteria

Stated as numbers, so the run has a verdict rather than an interpretation.

| # | Criterion | Threshold | Where to read it |
|---|---|---|---|
| 1 | Concurrently-active tenants sustained | **≥ 100** by §3's definition | count of distinct tenants with a request in each 10s bucket |
| 2 | Error rate | **< 0.1%**, and **zero** connection-acquisition failures | harness output; `ECONNREFUSED` / acquire timeouts are an automatic fail |
| 3 | p95 latency | within **2×** the single-tenant baseline | harness; baseline measured before the run |
| 4 | Postgres backend connections | stay under `max_connections` with **≥ 20% headroom** | `scripts/db/ops-status.js`, `connection-budget.js` |
| 5 | Pooler client queue | `pooler_cl_waiting` **= 0** sustained; `pooler_maxwait_us` < 100 ms | `tenant_health`, migration `0100` |
| 6 | Tenant health | no tenant RED for pool reasons; AMBER on utilisation is **acceptable and expected** | `platform.tenant_health` |
| 7 | Connections after load stops | return to baseline within 5 min | `registry.poolStats()`, `SHOW POOLS` |
| 8 | Two-replica soak | connections flat, not doubling | run steps again with 2 API replicas |

Criterion 8 is the one most likely to be skipped and it is the one that catches a per-process
assumption. Two replicas is how the fleet actually runs.

### The result that is not a failure

Expect criterion 6 to go AMBER on `pool_utilisation_pct`. That is the new early-warning signal
working exactly as designed — the point of it is to move *before* saturation. **A run that goes
amber on utilisation while criteria 1–5 hold is a pass**, and it is also the first real
validation that the threshold (default 80%) is set somewhere useful. If nothing ever goes amber
at 120 tenants, the threshold is too high to warn anybody and should be lowered.

---

## 6. What to do with the answer

- **If it passes at 120:** record the measured figure in `INFRASTRUCTURE_PLAN.md` §5 **with the
  date and the conditions**, replacing the assumed one. A measured number with its context is
  worth keeping; a bare number becomes the next assumption.
- **If it fails below 100:** the first levers, in order — `PGBOUNCER_DEFAULT_POOL_SIZE`,
  `PGBOUNCER_MAX_DB_CONNECTIONS`, then `TENANT_POOL_CACHE_MAX` (default 24 against 120 tenants is
  the first thing to suspect, because eviction churn costs a full connection setup per miss).
  Re-run after each single change; changing two makes the result uninterpretable.
- **Either way:** the harness stays in the repo and runs before any change to pooling, pool
  sizing or the credential path. The value of this work is not the one-off number — it is that
  the number stops being unknowable.

---

## 7. Cost and effort

Roughly **S–M**: a day to write the harness, a day to provision the fixture and run both passes,
half a day to interpret and write up. The dedicated database host for the duration is the only
real spend.

Cheap now. The alternative is discovering the ceiling from a customer, at which point it is an
incident, a migration and an apology.

---

*No production code is changed by this document.*
