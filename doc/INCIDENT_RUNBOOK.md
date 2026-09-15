# Incident runbook — Praxis LS

**OBS-I1 (Critical).** No document defined who is contacted, what counts as an
emergency, how it escalates, or what anyone is told. `DEPLOYMENT.md §7` has real
operational notes and a troubleshooting table, but it is a deployment guide: it
tells you how to deploy, not what to do at 02:00 when invoices will not post.

This is deliberately short. A runbook nobody reads is the same as no runbook, so
this covers the situations that have actually occurred or are one plausible step
away, and links out for the rest.

---

## 0. The thirty-second version

```
1. Is it up?          curl -s https://<tenant-host>/api/health/ready | jq .status
2. What changed?      curl -s https://<tenant-host>/api/health | jq .build
3. If a deploy did:   bash scripts/rollback.sh --list   then   <commit-sha>
4. Tell people        one line, in the channel, before you start digging
5. Write it down      section 6 — while it is fresh, not next week
```

Step 4 is not politeness. Two people debugging the same incident without knowing
about each other is how a five-minute outage becomes an hour.

---

## 1. Severity — pick one, out loud

|           | Definition                                              | Response                               | Examples                                                                            |
| --------- | ------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| **SEV-1** | Money or data is wrong, or every tenant is down         | Immediately, any hour                  | Ledger unbalanced, wrong VAT applied, cross-tenant data visible, all logins failing |
| **SEV-2** | One tenant down, or a core workflow broken for everyone | Within 1 hour, working hours + evening | One tenant's DB unreachable, invoices will not post, deploy loop failing            |
| **SEV-3** | Degraded but usable; a workaround exists                | Next working day                       | A report times out, realtime not delivering, one screen erroring                    |
| **SEV-4** | Cosmetic or single-user                                 | Backlog                                | Layout wrong, one user's export malformed                                           |

**When unsure, pick the higher one.** Downgrading later costs nothing.
Discovering at 09:00 that an overnight SEV-3 was silently corrupting the ledger
costs a great deal.

**Anything touching the general ledger is SEV-1 until proven otherwise**, because
posted entries are immutable — `protect_validated_entry` and the 0499 chain hash
mean a wrong entry cannot be quietly edited away, it has to be reversed, and
every hour it stands is another hour of reports built on it.

---

## 2. Who

Fill this in. An unfilled table is the same failure this document exists to fix.

| Role                  | Who   | Contact | When                                        |
| --------------------- | ----- | ------- | ------------------------------------------- |
| Primary on-call       | _TBD_ | _TBD_   | First responder, all severities             |
| Secondary             | _TBD_ | _TBD_   | No ack from primary in 15 min (SEV-1/2)     |
| Database / accounting | _TBD_ | _TBD_   | Anything ledger-, tax- or migration-related |
| Business owner        | Mark  | —       | SEV-1, and any SEV-2 lasting > 2 hours      |

**Escalation:** no acknowledgement in 15 minutes on a SEV-1 → secondary. Still
nothing after 15 more → business owner, whatever the hour.

Alerts land wherever `ALERT_WEBHOOK_URL` / `ALERT_EMAIL` point
(`doc/MONITORING_SETUP.md`). If those are unset the application logs a warning at
startup — a silent absence of alerting is indistinguishable from working
alerting right up until the night it isn't.

---

## 3. Triage — the four questions, in this order

### 3.1 Is the process alive, and can it serve?

```bash
curl -s https://<tenant-host>/api/health          # liveness — 200 while the process runs
curl -s https://<tenant-host>/api/health/ready    # readiness — 503 when it cannot serve
```

`/health/ready` returns the detail:

| Field                         | Meaning if unhealthy                                                      |
| ----------------------------- | ------------------------------------------------------------------------- |
| `checks.postgres`             | **Fatal.** Platform DB unreachable — no request can be routed to a tenant |
| `checks.redis`                | Degraded, not fatal. Sessions, rate limiting and job queues are affected  |
| `checks.modules.skipped`      | A feature module failed to mount. Those URLs are 404 right now            |
| `checks.dead_letters`         | Business events permanently undelivered — see 4.4                         |
| `checks.tenant_pools.waiting` | Sustained > 0 means requests are queueing for a DB connection             |
| `build.commit`                | Which commit is actually running                                          |

Note that `/health` cannot fail while the process is up — that is the point of
having two endpoints, and the original single endpoint that could not fail is
audit finding OBS-A2.

### 3.2 What changed?

Almost every incident follows a change.

```bash
curl -s https://<host>/api/health | jq .build      # commit + build time in production
git log --oneline -10 main
bash scripts/rollback.sh --list                    # tagged images available
```

### 3.3 Who is affected — one tenant or everyone?

Every log line carries `tenant`, `user_id` and `request_id` (OBS-L3). This is
the first question in any multi-tenant incident, and before that fix it was
unanswerable.

```bash
docker compose logs api --since 30m | grep '"level":50' | jq -r .tenant | sort | uniq -c | sort -rn
```

One tenant dominating → tenant-specific (their DB, their data, their migration
state). Spread evenly → platform-wide.

### 3.4 Reconstruct one failed request

Ask the user for the reference shown in the error, or find the request:

```bash
docker compose logs api --since 1h | grep '"request_id":"<id>"'
```

That id also appears on the rows the request wrote:

```sql
SELECT * FROM immutable_ledger WHERE request_id = '<id>' ORDER BY ledger_id;
SELECT * FROM event_log        WHERE request_id = '<id>' ORDER BY event_id;
```

And money-path operations log a structured event either way:

```bash
docker compose logs api --since 1h | grep '"money_event"' | jq -c '{money_event,outcome,doc,err}'
```

---

## 4. Playbooks

### 4.1 A deploy broke production

```bash
bash scripts/rollback.sh --list          # what can I roll back to?
bash scripts/rollback.sh                 # the previous build
bash scripts/rollback.sh <commit-sha>    # a specific one
```

Read the header of that script before you need it — it is explicit that the
database is the hard part, and it is right.

**Migrations do not roll back with the image.** `scripts/deploy.sh` takes a
`pg_dumpall` before migrating; that dump is the recovery path for a schema
change, and restoring it loses everything written since. If a migration is
implicated, get the database owner involved before doing anything — a hasty
restore is how an outage becomes data loss.

A deploy that **never got past `── fetching`** shipped nothing at all — the
fetch runs before the backup and the migrations, so production is still on the
previous build and there is nothing to roll back. That failure is a credential
problem on the server, not an outage: doc/DEPLOYMENT.md §6a.

### 4.2 The database is unreachable

`checks.postgres: down`. Confirm from the server, not from your laptop:

```bash
docker compose ps
docker compose logs postgres --tail 100
docker compose exec postgres pg_isready
```

If Postgres is up but the API cannot reach it, check `checks.tenant_pools`:
`waiting` above zero with `connections` at the cap is exhaustion, not an outage.
That is PERF S1 — the pool cache is bounded and LRU-evicts now, and
`TENANT_POOL_MAX` / `TENANT_POOL_CACHE_MAX` are the knobs. Above a few dozen
tenants the answer is PgBouncer: set `TENANT_DB_POOLER_HOST` and restart.

### 4.3 One tenant is down, everyone else is fine

Almost always that tenant's own database or its migration state.

```bash
node scripts/db/migrate-tenants.js --slug=<slug>
```

It is idempotent via the per-database migration ledger, so re-running a
migrated tenant is a no-op. Since the DATA 3.1 fix in `src/services/platform/migrator.js`, the
DDL and its ledger row commit together — before that, a crash between them left
a schema change applied but unrecorded, and the next run re-applied it.

DATA 3.2: a partial fleet upgrade leaves tenants on different schema versions,
and the tenant left behind is the one that breaks.

### 4.4 Business events are being dropped

`checks.dead_letters.status: degraded` names the tenants. These are events that
exhausted their retries — an invoice posted but its notification never sent, an
approval never opened. They do not self-heal.

### 4.5 Something is wrong with the books

**Stop. Do not fix it in the database.**

Posted entries are immutable by trigger. The correct remedy is a reversing
entry through the application, which leaves both the error and the correction
in the ledger — that is what an auditor needs to see. A direct `UPDATE` will be
refused by `protect_validated_entry`, and if it somehow succeeds it breaks the
0499 hash chain, which turns a recoverable accounting error into an unprovable
audit trail.

Get the database owner and whoever signs the accounts. This is never a
one-person decision.

### 4.6 Suspected compromise

1. **Preserve first.** `immutable_ledger` is append-only and hash-chained; do
   not truncate anything, do not "clean up".
2. Revoke the sessions — `POST /api/tenant/sessions/:id/kill` for one, or
   `POST /api/tenant/sessions/mine/revoke-all` for your own. Then suspend the
   account (`status = 'SUSPENDED'`), which fails auth on the next request
   because `authMiddleware` refuses any status other than ACTIVE.

   Suspending is the one that actually holds. Revoking a session ends that
   session; suspending ends the account's ability to get another. Note that
   `/:id/kill` carries `authMiddleware` but **no `requirePermission`** — unlike
   every other write on that router — so any authenticated user can kill any
   session by id. That is convenient here and is not something to rely on;
   it is logged as a new finding.

3. Rotate what may be exposed — `doc/MONITORING_SETUP.md` lists the secrets.
4. Check for privilege escalation:

```sql
SELECT * FROM immutable_ledger
 WHERE action IN ('permission.changed', 'app_user.password_set', 'app_user.updated')
   AND created_at > now() - interval '7 days'
 ORDER BY ledger_id DESC;
```

SEC H4 is the relevant history: MOD-67 `edit` could grant itself the CEO role or
set the CEO's password. Both are now refused, but a compromise that predates
that fix would look exactly like the rows above.

---

## 5. Communication

**Within 15 minutes of declaring a SEV-1 or SEV-2**, one message:

> **[SEV-n] <one line: what a user cannot do>**
> Started: <time>. Affected: <all tenants | tenant X>. Cause: <known | investigating>.
> Next update: <time — no more than 60 minutes away>.

Then hold to the update interval even when there is nothing new. "Still
investigating, next update 14:30" is information: it says someone is on it.
Silence gets interpreted as absence.

Say what a user cannot do, not what is broken. "Invoices will not post" is
useful to everyone; "the tenant pool is saturated" is useful to two people.

---

## 6. Afterwards

Within two working days, in `doc/incidents/YYYY-MM-DD-<slug>.md`:

- **Timeline** — first symptom, detection, mitigation, resolution. Include _how
  it was detected_: if a customer told you, that is the finding.
- **Impact** — who, how long, what data.
- **Cause** — the technical one and the one behind it. "The health check
  couldn't fail" was the technical cause of six deploys shipping broken code;
  the real cause was that nobody had ever tested it failing.
- **Actions** — each with an owner and a date. An action without one is a wish.

No blame. Every incident this codebase has had came from a control that was
documented as working and was not — a scanner pointed away from the secrets, a
health check that could not fail, `pino-http` declared and never mounted. Those
are system failures, and a review that looks for who erred will not find them.

---

## Related

- `doc/MONITORING_SETUP.md` — uptime monitor, alert routing, restart policy
- `doc/DEPLOYMENT.md` — how a deploy works; §7 troubleshooting
- `doc/BRANCH_PROTECTION.md` — TC-CI1, the settings change that stops most of this
- `scripts/rollback.sh` — list and roll back tagged images
- `doc/AUDIT_REGISTER_2026-08-04.xlsx` — every known finding and its status
