# Backup & restore, per tenant — full repo sweep (2026-09-30)

Everything in the repo that backs a tenant up or brings one back. Origin: `INFRASTRUCTURE_PLAN.md` §3.2 (WS-B1…WS-B4), ratified decisions **D4** (RPO ≤ 24h, ≤ 5 min with PITR; RTO ≤ 1h per tenant) and **D6** (offsite bucket in an independent account).

---

## 0. Plain-language version — what happens, on which screen, by whom

### Who starts a backup?

**Nobody, normally — the system starts it by itself.** Every night at **01:00 UTC** a background job wakes up and takes a copy of every live tenant's database, one after another. Nobody clicks anything. The same job also copies uploaded documents (02:00), checks those documents are not corrupted (Sunday, 04:00), tidies up old copies (03:00), and once a month (**1st of the month, 04:00**) it does a full rehearsal: it restores a tenant from its backup into a temporary copy, checks the data is all there, times how long it took, then throws the copy away.

**When a person does want to start one by hand**, it happens in the **Platform Console** (the internal Praxis staff console, not the tenant app):

> **Sign in to the Platform Console → left nav "Ops" → tab "Backup & restore"**

On that screen, top-right:

| Button | What it does | Confirmation it asks for |
|---|---|---|
| **Check tooling** | Verifies the backup/restore programs are installed and the right version. Read-only, safe for anyone. | none — opens a small "Backup tooling" panel |
| **Run drill** | Picks the tenant that has gone longest without a rehearsal and restores it into a scratch copy to prove the backup works. | *"Run a restore drill?"* → **Run it** |
| **Back up fleet** | Backs up **every** live tenant right now. | *"Back up every tenant now?"* → **Run it** |

And per tenant, in the **"Dump freshness"** table, each row has two buttons on the right:

| Button | What it does |
|---|---|
| **Back up** | Backs up **just that one tenant**, now |
| **Drill** | Restores **just that one tenant** into a scratch copy and checks it — the live tenant is never touched |

Further down the same page:

- **"Object storage"** card → per tenant, **Sync** (copy that tenant's documents offsite now) and **Scan** (check the documents are not corrupted).
- **"Run log"** card → **Apply retention** (delete copies that have aged out).

**Who is allowed to press them?** Only Platform Console staff, and only those whose role carries the **`ops.operate`** permission (Root Admin has it; it can be granted to Support or an on-call role from the Roles screen). Anyone with **`ops.read`** can see the whole screen but the buttons are simply not shown to them. Tenant users never see any of this — there is no backup button anywhere in the tenant application.

After you press a button you get a toast: *"Started — results will appear here when it finishes."* The work runs in the background (a fleet backup takes minutes), and the outcome appears in the **Run log** table at the bottom of the same page.

### Where is it stored?

Not on the same machine as the live data — that is the whole point.

| What | Where it goes | Naming |
|---|---|---|
| Database copies | The **backup store** — either a folder on disk (`./data/backups`, dev/small deployments) or an **S3 bucket in a different cloud account from the live data** (production; ratified as decision D6, so one leaked password cannot destroy both) | `pg/<tenant>/2026-09-30T01.dump` — one folder per tenant, one file per hour-stamped run |
| Uploaded documents (vault, branding, media) | Same backup store | `objects/<original path>` |
| Continuous change log (only if point-in-time recovery is switched on) | Same backup store | `wal/<segment>` |

Which of the two it is, and the credentials, are set in the console under **Settings → Storage → Backup** (falls back to `.env` if not set there). The screen shows the live destination, and there is a probe that writes, reads back and deletes a test file so a mis-typed bucket is caught now rather than during a real emergency.

**Retention:** every daily copy is kept **30 days**; Sunday copies are kept **12 weeks**. Nothing is ever deleted from the backup store because it was deleted from the live system — that would defeat the purpose.

**Proof it worked:** every single attempt, successful or failed, is written down as a row (`platform.backup_run`) and shown in the **Run log**. A tenant that has never been backed up is shown in red at the top of the page rather than quietly missing from the list.

### Who restores it?

Also Platform Console staff with **`ops.operate`** — never a tenant, and never automatically.

There are three different things people mean by "restore":

**1. The rehearsal (this is what happens 99% of the time, and it is automatic).**
Monthly job, or the **Run drill** / per-tenant **Drill** buttons. It restores into a **temporary throwaway database** named `praxis_drill_…`, checks it (are all the tables there? do the row counts match the live tenant within 5%? does the accounting ledger still balance?), records how long it took, and deletes the copy. **The live tenant database is never written to.** Results appear in the **"Restore drills"** card — pass/fail, measured time, and a **Checks** button showing exactly what was verified.

**2. A real recovery (a genuine emergency — data lost, tenant down).**
Now available on screen, to people holding the **`ops.restore`** permission only (Root Admin by default — it is *not* included in the permission that lets someone run backups and drills).

On the tenant's row in the **"Dump freshness"** table there is a **Restore…** button, after *Back up* and *Drill*. It opens a dialog that:

- warns that this is a **real recovery, not a drill**;
- offers an optional *"Recover to an earlier point"* date box (leave it blank for the newest copy);
- makes you **type the tenant's name** into a box to enable the red **"Restore into a new database"** button;
- states that this is **step 2 of 8** and lists what is still left to do by hand.

It restores into a **brand-new database** and stops. The tenant keeps running on its current database — nothing a user can see changes — so if the restore was the wrong call, nothing was lost by trying it. The confirmation screen names the new database and repeats the remaining steps. The result, with its integrity checks, appears in the **"Restore drills"** card like any other restore.

The same command still exists for an engineer who wants the fuller options (point-in-time, one document, force):

```
npm run db:restore:drill -- --slug=acme --into=tenant_acme_recovered --i-am-recovering
```

The `--i-am-recovering` flag is mandatory — without it the system refuses any destination that is not a throwaway drill database. Optional `--at=2026-09-28T12:00:00Z` picks an older copy instead of the latest.

**2b. Putting documents back.**
In the **"Object storage"** card, each tenant row now has a **Restore…** button next to *Sync* and *Scan* (again, `ops.restore` only). Type the tenant name, press **"Rehearse (changes nothing)"**, and it shows you the numbers first: how many documents are on record, how many would be put back, how many are already there and will be left alone, and how many are in neither place and cannot be recovered. Only then does the **"Restore N documents"** button become available. It never replaces a file that survived — a file still sitting there is never older than the backup, so replacing it could only lose work.

**3. Point-in-time recovery (rewind to an exact minute).**
Only available if the optional WAL feature is switched on. Off by default — the **"Recovery point"** card at the top of the screen tells you in plain words which one you have: *"24h recovery point — WAL archiving is off"* or e.g. *"6m recovery point"*.

### If something is actually lost — the order

1. **Database first** — the **Restore…** button on the tenant's row (or the command, for point-in-time). It lands in a new database; the tenant is still on the old one.
2. **Point the tenant at the restored database**, re-issue its credentials, refresh the pooler, and run any migrations the backup predates. This is the part that is still by hand, and it is written out step by step in `doc/INCIDENT_RUNBOOK.md` §4.3a.
3. **Documents second** — the **Restore…** button in the Object storage card (rehearse, read the numbers, then restore), or `npm run db:objects:restore -- --slug=<tenant> --dry-run` then for real.
4. Run a **Scan** to confirm every document the database expects is back, and **download one document as a tenant user** — that is the check that catches a database restored without its files.

Database before documents, always: the database is the list of which files should exist. Restore files first and there is nothing to check them against.

### The one number to look at

The top of the screen shows four counters: **Tenants · Stale · Never backed up · Never drilled**. If the last two are zero and the "Recovery point" card is green, the backups exist *and* have been proven to restore. If anything fails, it pages the on-call channel automatically — a failed backup and a failed drill are both treated as "wake someone up", because a backup nobody has restored is only a claim about a file.

---

## 1. One-paragraph answer

**Who backs up:** a BullMQ worker job — `backup-run` (`src/jobs/handlers/backup-run.js`), registered in `src/jobs/workers.js` and fired by cron (`BACKUP_CRON`, default `0 1 * * *`). It calls `backup.service.backupFleet()`, which loops LIVE tenants **sequentially** and runs one `pg_dump --format=custom --compress=6` per tenant database, streamed straight to the offsite store. Every attempt — success or failure — is a row in `platform.backup_run`. Humans can do the same thing on demand from the platform console (`POST /platform/ops/backups[/:slug]`, capability `ops.operate`) or the CLI (`npm run db:backup`).

**How it is restored:** `src/services/platform/restore.service.js` → `restoreTenant()`. It finds the tenant's latest OK `PG_DUMP` row, verifies the artefact's size against the store, stages it to a **local temp file** (pg_restore must be able to seek), creates a database and runs `pg_restore` into it, then runs integrity probes (schemas present, live table count, row counts vs the live source within 5%, ledger trial-balance) and records the measured RTO in `platform.restore_drill`. By default the target is a throwaway `praxis_drill_<slug>_<epoch>` database that is dropped in a `finally` — that is the **monthly drill** (`RESTORE_DRILL_CRON`, default `0 4 1 * *`). A **real recovery** is the same function with `allowNonDrillTarget: true` / CLI flag `--i-am-recovering`, which is the only way to target a non-drill database name. Point-in-time recovery between dumps is Postgres-native: `restore_command` → `scripts/db/wal-restore.js`.

---

## 2. File inventory

### Backend services (the engine)

| File | Lines | Role |
|---|---|---|
| `src/services/platform/backup.service.js` | 577 | **WS-B1.** `pg_dump` per tenant, `backupFleet`, `preflight`, `backupStatus`, `recentRuns`, `walStatus`, `recordWalStatus`, `startRun`/`finishRun` bookkeeping |
| `src/services/platform/restore.service.js` | 568 | **WS-B3.** `restoreTenant`, `runScheduledDrill`, `recentDrills`, `cleanupDrillDatabases`, `latestBackup`, probes (`tableCounts`, `trialBalance`) |
| `src/services/platform/backup-storage.service.js` | 518 | Offsite store, two drivers (`local`, `s3`), stream + SHA-256 + byte-count tap, `putStream/openStream/exists/stat/list/remove`, `pruneRetention`, `describe` |
| `src/services/platform/object-backup.service.js` | 316 | **WS-B2 / WS-B4.** Vault-document offsite sync (`syncTenantObjects`, `syncFleetObjects`) and content-hash integrity scan (`scanTenantIntegrity`, `scanFleetIntegrity`), `objectBackupStatus` |
| `src/services/platform/runtime-config.service.js` | — | `backupStorage()` (vault-first driver + credentials, TTL-cached) and `opsTuning()` (`backupRetainDailyDays`, `backupRetainWeeklyWeeks`, `restoreRtoTargetSeconds`, `walMaxLagMinutes`) |
| `src/services/platform/settings.probes.js` | — | `backupStorage` probe: writes / reads / deletes a probe object so a write-only or unreadable bucket is found now, not at restore time |
| `src/services/platform/alert-routing.service.js` | — | Severity map: `backup.failed` → **page**, `restore.drill.failed` → **page**, `backup.stale` → notify, `drill.slow` → notify; `backupStatus()` sweep emits `backup.stale` |
| `src/services/platform/maintenance.service.js` | ~209 | Attaches the tenant's backup state to a support-ticket telemetry snapshot |

### Jobs & schedule

| Where | What |
|---|---|
| `src/jobs/handlers/backup-run.js` | One queue, six job names: `fleet` (default), `prune`, `objects`, `scan`, `wal`, `drill`. **Throws on failure by design** so workers.js routes it to the terminal-failure/alert path |
| `src/jobs/workers.js:238` | Worker registration, `concurrency: 1` |
| `src/jobs/workers.js:871-956` | Cron registration: `fleet` at `BACKUP_CRON`; `prune` at **+2h**; `objects` at **+1h**; `scan` weekly Sunday at **+3h**; `wal` every **15 min** (only if `WAL_ARCHIVE_ENABLED`); `drill` at `RESTORE_DRILL_CRON`. Empty crons log a loud warning ("tenants have no scheduled backup" / "backups will never be verified by restore") |

### HTTP surface (platform console API)

`src/modules/platform/ops/ops.routes.js` — mounted under `platformAuth` by `src/modules/platform/platform.routes.js`. Capability tiers created in `migrations/platform/0096_ops_capabilities.sql`.

| Method + path | Cap | Controller |
|---|---|---|
| `GET /ops/backups` | `ops.read` | `backupStatus` — per-tenant freshness, stale/never counts |
| `GET /ops/backups/runs` | `ops.read` | `backupRuns` — raw run log (filter kind/slug/status) |
| `GET /ops/backups/preflight` | `ops.read` | `backupPreflight` — pg_dump/pg_restore identity + version vs server |
| `GET /ops/backups/wal` | `ops.read` | `walStatus` — archive lag and the RPO that actually holds |
| `POST /ops/backups` | `ops.operate` | `backupAll` — detached fleet dump, **202** |
| `POST /ops/backups/:slug` | `ops.operate` | `backupOne` — detached single-tenant dump, **202** |
| `POST /ops/backups/prune` | `ops.operate` | `backupPrune` — apply retention |
| `GET /ops/objects` | `ops.read` | `objectStatus` |
| `POST /ops/objects/:slug/sync` \| `/scan` | `ops.operate` | `objectSync` / `objectScan`, detached |
| `GET /ops/drills` | `ops.read` | `drills` — history + per-tenant coverage + `never_drilled` |
| `POST /ops/drills` | `ops.operate` | `drillScheduled` — least-recently-drilled tenant |
| `POST /ops/drills/:slug` | `ops.operate` | `drillOne` (body `{ at }` targets an older dump) |

All POSTs are **detached** (`detach()` in `ops.controller.js:61`) and answer 202 — a fleet dump outlives any proxy timeout; the result lands in `backup_run` / `restore_drill`.

### Console UI

- `platform-console/src/features/ops/OpsBackups.tsx` (401 lines) — "Backup & restore" screen: freshness table, run log, WAL panel, object sync/scan, drill history with a detail modal, "Check tooling", "Back up now", "Run drill". Write buttons hidden behind `canOperate()`.
- `platform-console/src/lib/ops-api.ts` — typed client (`backupStatus`, `backupRuns`, `backupPreflight`, `walStatus`, `backupTenant`, `backupFleet`, `pruneBackups`, `objectStatus`, `drills`, `drillTenant`, `drillScheduled`) and types `BackupRun`, `BackupPreflight`, `WalStatus`, `RestoreDrill`, `DrillsResult`.
- `platform-console/src/features/ops/OpsNav.tsx:15`, `App.tsx:58` — route `/ops/backups`.
- `platform-console/src/features/TenantDetail.tsx:89` — per-tenant recoverability note.

### CLI

| Command | Script |
|---|---|
| `npm run db:backup` (`--all`) | `scripts/db/backup-tenant.js` |
| `npm run db:backup:status` | freshness table; **exits 1** if any tenant stale/never — usable as a deploy gate |
| `npm run db:backup:preflight` | pg_dump/pg_restore/server version check |
| `--slug=<t>` / `--prune` / `--objects` / `--scan` | same script |
| `npm run db:restore:drill -- --slug=acme [--at=<iso>] [--keep]` | `scripts/db/restore-tenant.js` |
| `… --into=<db> --i-am-recovering` | **real recovery** into a named database |
| `npm run db:restore:history` | past drills, RTO vs target |
| `npm run db:restore:cleanup` | drop leftover `praxis_drill_*` databases |

### WAL / PITR (layer 2, opt-in)

- `scripts/db/wal-archive.js` — Postgres `archive_command`. Validates the segment name, refuses to overwrite a differently-sized segment, verifies the checksum, exits non-zero on failure (so Postgres retries and keeps the segment).
- `scripts/db/wal-restore.js` — Postgres `restore_command`. Exit 1 on a missing segment is the *normal* end of recovery; downloads to `.praxis-partial` and renames.
- `docker-compose.wal.yml` + `docker/postgres/Dockerfile` — opt-in overlay: pgvector image + Node 20, `archive_mode=${WAL_ARCHIVE_MODE}`, `archive_timeout=300`, `archive_command=/usr/local/bin/praxis-wal-archive %p %f || exit 1`. Notes that compose *replaces* `command`, so `max_connections` is repeated.

### Schema

`migrations/platform/0094_backup_registry.sql`

- **`platform.backup_run`** — `tenant_id` (NULL = fleet artefact, `ON DELETE SET NULL` so history survives deprovisioning), denormalised `slug`, `kind ∈ (PG_DUMP, WAL, OBJECT_SYNC, SNAPSHOT_SCAN)`, `status ∈ (OK, FAILED)`, `bytes`, driver-qualified `location`, `checksum` (SHA-256), `started_at`/`finished_at`, **generated** `duration_ms`, `error`. Partial indexes for "latest OK per tenant" and "recent failures".
- **`platform.restore_drill`** — `backup_run_id` (which artefact), `restored_to`, **`rto_seconds`** (the D4 number, measured), `ok`, `checks_json`, `error`, `ran_at`. Partial index on failed drills.
- No retention on either table — deliberate; the long view is the value.

`migrations/platform/0096_ops_capabilities.sql` — `ops.read` / `ops.operate` / `ops.maintain`, granted to `PLATFORM_ROOT_ADMIN` so they exist in the matrix and can be delegated.

### Tests

- `tests/unit/backup-restore.test.js` (449) — `backupTenant`, `backupFleet`, `preflight`, `backupStatus`, **restore drill safety** (non-drill target refused), retention windows.
- `tests/unit/backup-storage.test.js` (134) — "putStream writes every byte" (the truncation regression), failure handling, listing.
- `tests/unit/ops-routes.test.js`, `tests/unit/platform-capability-coverage.test.js`, `tests/unit/kaizen-ops.test.js` — routing + capability gating.

---

## 3. The backup flow, end to end

```
cron BACKUP_CRON ─▶ queue "backup-run"/"fleet" ─▶ backup.backupFleet()
   preflight() once           ← pg_dump/pg_restore exist, are the right binary, ≥ server major
   for each LIVE tenant (sequential):
       startRun(kind=PG_DUMP) → row inserted as FAILED
       resolveCredential(meta)                      ← per-tenant DB role (WS-S2)
       spawn pg_dump -Fc -Z6 --no-owner --no-acl    ← PGPASSWORD in env, never argv
              …direct to meta.db_host, NOT through PgBouncer (a txn pooler cannot
                hold pg_dump's snapshot)
       Promise.all([ store.putStream(stdout, key), exited ])
              key = pg/<slug>/<YYYY-MM-DDTHH>.dump
              local: → *.partial, stat-verify, rename       s3: → multipart Upload + HeadObject verify
       finishRun(OK, bytes, location, sha256)
```

Design choices that are load-bearing (and documented in-file):

1. **Streamed, never buffered** — a tenant dump does not fit in the worker heap.
2. **Password never in argv** — `ps` is world-readable for the minutes a dump runs.
3. **Continue on failure** — one unreachable tenant must not stop the fleet.
4. **Row inserted as FAILED, promoted to OK only after durable write** — a killed process leaves a FAILED row, not silence.
5. **Both the upload *and* `pg_dump`'s exit code are awaited** — a partial dump recorded OK is the worst possible artefact.
6. **`HashingCounter` is a `Transform`, not a `PassThrough` + `data` listener** — the latter silently truncated dumps while recording the full byte count and checksum (the scar comment is in `backup-storage.service.js`).

Freshness (`backupStatus`): per-tenant lateral joins for last OK and last FAILED; `stale` = older than `rpoHours + graceHours` (24 + 6); `never_backed_up` surfaced separately so it cannot hide as an absent row.

Retention (`pruneRetention`): keep everything ≤ `backupRetainDailyDays` (30); additionally keep Sunday dumps ≤ `backupRetainWeeklyWeeks` (12w). Sunday test first, so a weekly candidate inside the daily window is not dropped early.

---

## 4. The restore flow, end to end

```
restoreTenant({ slug, at, into, drop, allowNonDrillTarget, recordDrill })
 1 slugOk(slug)
 2 target = into || `${RESTORE_DRILL_DB_PREFIX}${slug}_${Date.now()}`
   ── refuse any target without the prefix unless allowNonDrillTarget
 3 latestBackup(slug, at)            ← newest OK PG_DUMP at/before `at`
 4 source row counts from the LIVE tenant DB (comparison baseline)
 5 store.stat(key)                   ← artefact present? size == backup_run.bytes? (truncation)
 6 backup.preflight()                ← pg_restore is really pg_restore and new enough
 7 migrator.ensureDatabase(target)
 8 withLocalDump(key, …)             ← stage to os.tmpdir(); custom-format archives need seek,
                                       a pipe made pg_restore exit 0 restoring nothing
 9 pg_restore -Fc --no-owner --no-acl --dbname=target file   (NOT --exit-on-error: probes judge)
10 probes: schemas present (live/sandbox) · live table count · row counts vs source ±5%
          · trial balance (Σdebit == Σcredit) on live.journal_line
11 ok = tables>0 AND live present AND counts not false AND balance not false
12 finally: drop the scratch DB WITH (FORCE) — only if the name carries the drill prefix
13 rto_seconds vs opsTuning().restoreRtoTargetSeconds → row in platform.restore_drill
```

Three restore paths:

| Path | Trigger | Target | Notes |
|---|---|---|---|
| **Drill (scheduled)** | `backup-run`/`drill` monthly, `runScheduledDrill()` | scratch, dropped | Picks the **least-recently-drilled LIVE tenant, never-drilled first**. Sweeps stale drill DBs > 60 min old first. Fails → job throws → `restore.drill.failed` → page |
| **Drill (manual)** | console "Run drill" / `POST /ops/drills[/:slug]` / CLI | scratch, dropped (`--keep` to inspect) | `at` targets an older dump |
| **Real recovery** | CLI `--into=<db> --i-am-recovering` (or service `allowNonDrillTarget:true`) | named DB | Deliberately unreachable by default |
| **PITR** | Postgres `restore_command` = `wal-restore.js`, `recovery_target_time` | cluster | Only when the WAL overlay is enabled |

Rationale quoted in-file: *"A drill that could touch the live tenant database is a drill nobody will schedule."*

---

## 5. Configuration

`src/config/env.js:708-754`, `.env.example:395-421` and `:590-613`. Storage driver/credentials, retention and RTO/WAL-lag targets are **vault-first** (`platform settings` → `storage.backup`, `ops.tuning`), resolved *per call* so a console change applies to the next backup, not the next deploy.

| Var | Default | Meaning |
|---|---|---|
| `BACKUP_DRIVER` | `local` | `local` \| `s3` |
| `BACKUP_LOCAL_PATH` | `./data/backups` | local root |
| `BACKUP_S3_*` | — | endpoint/bucket/keys/region/path-style — **separate account from primary storage (D6)** |
| `BACKUP_RETAIN_DAILY_DAYS` / `_WEEKLY_WEEKS` | 30 / 12 | retention windows |
| `BACKUP_CRON` | `0 1 * * *` | nightly fleet dump; empty = disabled + warning |
| `PG_DUMP_BIN` / `PG_RESTORE_BIN` | `pg_dump` / `pg_restore` | full path on Windows |
| `RESTORE_DRILL_CRON` | `0 4 1 * *` | monthly rehearsal |
| `RESTORE_DRILL_DB_PREFIX` | `praxis_drill_` | the safety fence |
| `RESTORE_RTO_TARGET_SECONDS` | 3600 | D4's RTO ≤ 1h |
| `WAL_ARCHIVE_MODE` | `off` | Postgres `archive_mode` (compose) |
| `WAL_ARCHIVE_ENABLED` | `false` | app-side health check + alerting |
| `WAL_ARCHIVE_PREFIX` | `wal` | key prefix in the backup bucket |
| `WAL_MAX_LAG_MINUTES` | 15 | staleness threshold |

`walStatus()` reports `rpo_minutes = 24*60` whenever archiving is off, misconfigured (`ENABLED` true but `archive_mode=off`), empty or stale — deliberately refusing to advertise a 5-minute RPO off the back of a dead archiver.

---

## 6. Findings / gaps

> **Status at a glance** — see §7 for the detail.
>
> | # | Finding | Status |
> |---|---|---|
> | **F1** | WAL archiver called its storage function with the arguments reversed — point-in-time recovery could never have worked | ✅ **Fixed** (+7 tests) |
> | **F2** | "Apply retention" only ever pruned database dumps; the change-log archive grew forever | ✅ **Fixed** |
> | **F3** | Encryption at rest and a delete-proof bucket are assumed, never set or verified | ⬜ **Open — needs a decision from you** |
> | **F4** | Restore assumes every tenant is on the default database server; backup does not | ✅ **Fixed** |
> | **F5** | Documents could be backed up but never restored | ✅ **Fixed** (+9 tests) |
> | **F6** | The rehearsal checks the restored copy's `live` schema by hard-coded name, while reading the source by its configured name | ✅ **Fixed** |
> | **F7** | A real recovery stops at the restored database; the cutover steps are undocumented | ◐ **Written** (runbook §4.3a) — needs one rehearsal |
> | **F8** | `DEPLOYMENT.md` advertised a manual `pg_dumpall` as the backup | ✅ **Fixed** |
> | **M1** | Chat photos, voice notes and video were outside the backup entirely | ✅ **Fixed** |
> | — | The monthly rehearsal still proves only the database, not documents | ✅ **Fixed** (+5 tests) |


**F1 — `wal-archive.js` calls `putStream` with reversed arguments (breaks PITR).**
`scripts/db/wal-archive.js:101`: `store.putStream(key, fs.createReadStream(sourcePath))`, but the signature is `putStream(readable, key)` (`backup-storage.service.js:413`). With the local driver this fails the `assertSafeKey` check on a stream object and `archive_command` exits 1 → Postgres retries forever and WAL never recycles. No test covers this script. **One-line fix; highest-value item here.**

**F2 — retention never prunes objects or WAL.** `pruneRetention()` defaults to `prefix: "pg/"` and every caller (`backup-run.js:81`, `ops.controller.js:135`, CLI `--prune`) calls it with no arguments. `objects/` and `wal/` grow without bound.

**F3 — no encryption-at-rest or bucket immutability in code.** §3.2 calls for SSE + a Praxis-held key and a write-once/versioned bucket; the S3 driver sets no `ServerSideEncryption` and nothing asserts versioning/object-lock. Currently a bucket-policy assumption, not an enforced property.

**F4 — restore always uses `TENANT_DB_HOST_DEFAULT`.** `spawnPgDump` honours `meta.db_host`/`meta.db_port` per tenant, but `superuserClient()` and `runPgRestore()` hardcode the defaults. A tenant on a non-default host backs up correctly and drills against the wrong server.

**F5 — object backups have no restore path.** `syncTenantObjects` copies the vault offsite and never deletes (correct), but there is no inverse (`restoreObjects`), no CLI, no route. Threat 4 ("a vault document is deleted or corrupted independently of Postgres") is *detected* by the integrity scan and *covered* by the sync — but recovery is manual bucket surgery, and the drill does not exercise it.

**F6 — the drill hardcodes the `live` schema on the restored side** (`tableCounts(cli, "live")`, `trialBalance(cli, "live")`) while the source side honours `meta.live_schema`. Fine today; silently mis-compares if a tenant ever uses a different schema name.

**F7 — a real recovery ends at the database.** `restoreTenant --i-am-recovering` produces a restored database and nothing else: no registry re-point (`platform.tenant.db_name`), no credential re-issue, no cutover step. The last mile of an actual tenant recovery is undocumented — worth a short runbook in `doc/INCIDENT_RUNBOOK.md`, which currently mentions backups only in passing.

**F8 — `doc/DEPLOYMENT.md:336` still advertises a manual `pg_dumpall` as the "minimum viable backup"**, predating WS-B1. Stale advice next to a working system.

*(Unrelated senses of "restore" found by the sweep and excluded: `migrations/tenant/0641_dictionary_recycle_bin.sql`, `client/src/lib/form-draft.ts` draft restore, `client/src/lib/outbox.ts` — tenant-app UX, not disaster recovery.)*

---

## 7. Fixes — what was changed, and what is still open

### Done

**1. Point-in-time recovery could never have worked. Fixed.**
The script Postgres calls to ship its change log offsite passed its two arguments the wrong way round. Every segment would have failed, forever, and Postgres — behaving correctly — would have kept refusing to recycle the log it could not ship, until the disk filled up days later with the console still showing healthy nightly backups. The feature is off by default, so this had not bitten yet; anyone switching it on would have found it the hard way.
Files: `scripts/db/wal-archive.js` (logic split out of the command-line wrapper so it can be tested at all), `tests/unit/wal-archive.test.js` (new, 7 tests, including one that pins the argument order specifically).

**2. Chat photos, voice notes and video were never backed up. Fixed.**
The offsite document copy decided what to copy by reading one table — the document vault. Chat media is deliberately kept in a different table, so none of it was ever copied offsite or integrity-checked, and nothing reported the gap: the nightly job succeeded every night, because it did copy everything it knew about.
The list of places files live is now an explicit, named list in one place, and adding an upload path without adding it there is the thing that becomes visible. Tenants too old to have the newer table are handled as "no files there", not as an error.
Files: `src/services/platform/object-backup.service.js`, `tests/unit/object-backup-restore.test.js` (new).
*Deliberately still excluded: thumbnails and e-mail signature images, because both are regenerated automatically from data that is backed up. Copying them would multiply the file count for bytes nobody would ever restore.*

**3. Documents could be backed up but not restored. Fixed.**
There was no way back: files went offsite nightly and nothing brought them home. Recovering one deleted document meant an engineer reaching into the bucket by hand, during an incident.
There is now a restore, built to be safe in an emergency rather than clever:
- it never overwrites a file that is still there (unless explicitly forced), because during a partial loss replacing surviving files with older copies makes things worse;
- it checks each file's fingerprint before writing, so a corrupted offsite copy is reported instead of restored over a good file;
- `--dry-run` tells you exactly what it would do without touching anything — which is what anyone should run first;
- `--doc=<id>` restores a single document, the common real-world case;
- every run is recorded, and a run that could not find files is recorded as a failure, so it reaches the alert channel rather than a log nobody reads.

Files: `src/services/platform/object-backup.service.js` (`restoreTenantObjects`), `scripts/db/restore-objects.js` (new), `npm run db:objects:restore`, `migrations/platform/0111_backup_run_object_restore.sql` (lets the new kind of run be recorded).

**4. "Apply retention" never cleaned up the change log. Fixed.**
Retention had a default that was right for database dumps and silently wrong for everything else, and all three callers used the default — so the WAL archive grew forever in the bucket everyone is billed for. Retention now means dumps *and* WAL, everywhere it is triggered (nightly job, console button, command line).
Document copies are still never deleted by age, and that is now written down as a decision rather than left as an oversight: expiring them would mean the backup destroying the last copy of a file someone deleted — the exact event the copy exists for.
Files: `src/services/platform/backup-storage.service.js` (`pruneBackups`), `src/jobs/handlers/backup-run.js`, `src/modules/platform/ops/ops.controller.js`, `scripts/db/backup-tenant.js`, `tests/unit/ops-routes.test.js`.

**5. Deployment notes told operators to do it by hand. Fixed.**
`doc/DEPLOYMENT.md` still advertised a manual `pg_dumpall` as the "minimum viable backup" — advice that predates all of this and now actively misleads, because a hand-run dump is unmonitored, unrecorded, and sits on the very host whose loss it is supposed to cover. It now points at the scheduled system, the two commands that *verify* it, and the recovery order.

**Checks run:** the new tests pass (16), migration numbering, reversibility, idempotency, constraint-guard, destructive-migration, silent-catch, write-route-validator and env-template gates all pass. The wider suite and ESLint could not be run here — this sandbox has no network access to install dependencies — so they should be confirmed by CI.

### Second pass — A, D, E closed; C written

**A. The restore now follows the tenant to its own database server.** Backups
already looked up which server a tenant lives on; restores assumed the default.
Identical today, and silently wrong the first time a tenant is moved — the
rehearsal would have built its test copy on the wrong machine, compared it
against a source it could not reach, and still said "passed". The server now
travels with the tenant through every step: creating the copy, restoring into
it, reading the original, and dropping the copy afterwards. Defaults are
unchanged, so nothing about today's single-server setup behaves differently.
*Files:* `src/services/platform/restore.service.js`, `src/services/platform/migrator.js`.
*No direct test:* proving it needs a second Postgres server in the fixture. The
defaults are covered by the existing tests; the change is small and readable.

**D. The monthly rehearsal now also proves documents come back.** It picks a
few documents at random from the restored copy, fetches them from the offsite
store, and checks each one against the fingerprint the database says it should
have. A document that cannot be fetched, or comes back altered, now fails the
drill — because that is exactly "the backup does not restore". A tenant with no
hashed documents is reported as "nothing to check", not quietly passed. Visible
in the console's drill **Checks** panel and in the command-line output.
*Files:* `src/services/platform/restore.service.js`, `scripts/db/restore-tenant.js`, `tests/unit/backup-restore.test.js` (+5 tests).

**E. The rehearsal no longer hard-codes the schema name** on the restored side
while reading the original by its configured name.

**C. The recovery procedure is now written down** — `doc/INCIDENT_RUNBOOK.md`
§4.3a, end to end: decide the recovery point, dump the damaged state first,
park the tenant, restore into a new database, re-point the registry, re-issue
credentials and the pooler, apply missed migrations, restore documents *after*
the database, verify by downloading one, then lift the window and say plainly
what was lost. It is marked **written but not rehearsed**, because it has not
been walked end to end on a copy — see "needs your input" below.

### Needs a decision from you

| | What I need | Why I stopped |
|---|---|---|
| **F3 / B — encryption and a delete-proof backup bucket** | Which cloud account the backups live in, who holds the key, and whether the bucket can be switched to versioned + delete-protected | The plan says backups sit in a *separate* account so stolen app credentials cannot destroy them, and that they are encrypted with a key we hold. The code sets neither, and I cannot pick an account, create a key, or change bucket policy from here. Once you name the account and key, the code side is an afternoon: set encryption on upload, and make the existing backup-destination self-test report versioning and delete-protection on screen so it stops being folklore. |
| **C — rehearsing the recovery** | An hour, a throwaway tenant copy, and someone who can approve doing it | A recovery procedure nobody has run is the same category of claim as a backup nobody has restored. I can drive it; it needs a scheduled window and your go-ahead, because it touches the registry and the pooler. |
| ~~The restore button~~ | ~~A product decision~~ | **Decided: option 3 — both buttons built.** See §10 for the safeguards. |

## 8. Follow-up questions, answered against the code

### Q1 — Is media backed up separately from the database, per tenant? **Yes — and the hole this sweep found has since been closed.**

**What exists.** `src/services/platform/object-backup.service.js` does exactly this: a second, separate backup that copies *files* (not database rows) to the offsite store, **per tenant**, on its own nightly schedule (02:00, one hour after the database dump), recorded as its own `OBJECT_SYNC` run per tenant. Buttons: **Sync** per tenant row in the "Object storage" card. It never deletes from the destination — deleting a file from the live system does not delete the backup copy, which is the whole point.

**How it decides what to copy — and where the gap is.** It enumerates from the **database**, not by listing the storage bucket, which is the right instinct (a bucket listing tells you what storage happens to hold; the table tells you what the app *believes* it has, and the difference is the finding). But it enumerates exactly one table:

```sql
SELECT doc_id, storage_path, content_hash, created_at FROM document_vault …
```

Files written to primary storage that are **not** `document_vault` rows are therefore never copied offsite. From the sweep, the writers to `storage.put()` are:

| Writer | Recorded in | Covered by the offsite sync? |
|---|---|---|
| `document_vault.service` — vault documents | `document_vault` | ✅ yes |
| `site_settings.media` — branding/logos | `document_vault` (it goes through the vault) | ✅ yes |
| `smartcomm.media.service` — chat attachments that are *documents* | `document_vault` | ✅ yes |
| `smartcomm.media.service` — chat **images/audio/video** → `tenant_<slug>/chat/…` | **`comms_media`** | ❌ **no** |
| `signature.service` / `signature.diagnose` — mail signature images | `signature_render` / own tables | ❌ **no** (verify per table) |
| `qes.service` — signed PDFs | verify | ⚠️ verify |
| `support.service` (tenant + platform) — ticket attachments | own table | ❌ **no** |
| `image-pipeline.putDerivatives` — thumbnails/webp variants | not a row at all | ❌ no — **acceptable**, they are regenerated on demand by the `/media` route |

**FIXED (§7, fix 2).** The enumeration is now driven by an explicit list of every table that owns files (`OBJECT_SOURCES`), so chat media is copied offsite and scanned like everything else, and a tenant too old to have the table is treated as "no files there" rather than an error. Thumbnails and signature images stay excluded on purpose — both regenerate automatically from data that *is* backed up.

The residual risk is unchanged in kind and much smaller in size: coverage is still "what the tables say", so a future upload path must be added to that list. It is now one obvious list in one file rather than a query buried in a service.

### Q2 — What order is a restore done in: database first, or media first?

**Database first, then media** — and now that both can be restored (§7, fix 3), that order is enforced by how the media restore works: it reads the tenant's tables to learn which files should exist. Two structural reasons:

1. **The database is the index.** Knowing *which* files should exist, where they live, and what they should hash to is information held in `document_vault` / `comms_media`. Restore media first and you are copying files back without knowing which ones belong, which are stale, or which are missing.
2. **Extra files are harmless; missing rows are not.** With the database in place, the media restore becomes a checkable operation — walk the rows, fetch `objects/<path>` for each, verify the SHA-256 against `content_hash`, report anything missing. Done the other way round you cannot verify anything, and orphaned files sit in storage indefinitely.

The one nuance: the database dump and the media sync are taken **an hour apart** (01:00 and 02:00), so a document uploaded between them exists as a file with no row, and a document uploaded just before 01:00 exists as a row with no file until the next night. Neither is data loss, but a restore should expect a small number of both and report them rather than fail. Recommended sequence for a real recovery:

1. Restore the tenant database (`--i-am-recovering`).
2. Point the tenant at it and run outstanding migrations.
3. Restore media from `objects/` driven by the restored rows.
4. Run the integrity scan — it is precisely the "did every row get its file back" check.
5. Only then lift the maintenance window.

### Q3 — What is WAL archiving, and what does it buy?

WAL = "write-ahead log". Before Postgres changes anything, it first writes a description of the change to a log file. That log is the database's own running commentary on every insert, update and delete, in order.

**Archiving** it means: every time Postgres finishes one of those log files (or every 5 minutes, whichever comes first), it ships a copy offsite immediately.

**What it buys: how much work you lose in a disaster.**

- **Nightly dumps only** (today's default): the most recent copy of a tenant is last night at 01:00. Lose the server at 23:00 and you have lost **23 hours of work** — every invoice, message and document created that day.
- **Nightly dumps + WAL archiving**: you restore last night's dump and then *replay the commentary* on top of it up to any chosen moment. Lose the server at 23:00 and you lose **about 5 minutes**.

That is the difference between decision D4's two numbers: RPO ("recovery point objective" — how much you lose) of **24 hours** versus **5 minutes**. It also allows "rewind to just before 14:32" — the answer to *someone ran a bad bulk update at 14:33* — which a nightly dump cannot do at all.

**Status here:** built, tested in principle, **off by default** (`WAL_ARCHIVE_ENABLED=false`). It needs a custom Postgres container (`docker-compose.wal.yml`), so turning it on is a deliberate act with a restart. The "Recovery point" card at the top of the Backup & restore screen tells you which regime you are actually in, and refuses to advertise 5 minutes if the archive has gone stale. **Note F1 in §7: as written, the archiver script has a reversed-argument bug and would fail on every segment — this must be fixed before anyone turns the feature on.**

### Q4 — What does "drill" mean here?

A **fire drill for the backups**. Nothing is being backed up and nothing is being repaired; the system is *practising the recovery* on a copy, while everything is fine, to find out whether the backup would actually work.

Concretely, one drill:

1. Takes the tenant's most recent backup file.
2. Creates a brand-new **temporary** database called `praxis_drill_<tenant>_<timestamp>`.
3. Restores the backup into it.
4. Interrogates the result: are the tables all there? Do the row counts match the live tenant within 5%? **Does the accounting ledger still balance** (debits = credits — a property no correct copy of the data can break)?
5. Records pass/fail and **how long the whole thing took** — the measured "RTO", checked against the 1-hour target.
6. Deletes the temporary database.

The live tenant is never written to, and the code physically refuses to restore into any database whose name does not start with `praxis_drill_` unless someone passes an explicit "I am really recovering" flag.

**Why it exists:** a backup file is a *claim* that data can be recovered. Until someone has actually recovered from it, it is an untested claim — and the ways it fails (a dump that restores to an empty database, a truncated file, a version mismatch) are all invisible from the outside. This project shipped a bug that wrote truncated dumps while recording the correct byte count and checksum; **only a restore could have caught it.** Hence: monthly, automatic, on the tenant that has gone longest without one, and a failed drill pages someone.

### Q5 — What do "Sync" and "Scan" mean in the Object storage card?

Both are about **files** (documents, images), not database rows.

**Sync** = *copy this tenant's files to the offsite store.* Incremental — it skips anything already there, so re-running after a failure resumes rather than starting over. It **never deletes** from the offsite copy: if someone deletes a document from the live system, the backup keeps it, because deletion is one of the things you are backing up *against*. This is the media equivalent of the nightly database dump.

**Scan** = *check the files that are supposed to be there are actually there, and are not corrupted.* It walks the database's list of documents and, for each one, fetches the file and re-computes its SHA-256 hash against the hash recorded when it was uploaded. Three possible findings:

| Finding | Meaning | Severity |
|---|---|---|
| **Missing** | The database says this document exists; storage does not have it. The app will offer it to a user and fail. | Worst — invisible until someone clicks |
| **Corrupt** | The file is there but its contents have changed. A backup would faithfully copy the damage. | Silent data loss |
| **Unhashed** | No hash was ever recorded, so nothing can be checked. | Not damage, but a blind spot |

The point of scanning on a schedule (weekly) is to find corruption **before** a restore needs the file. Discovering it during a recovery is discovering it at the worst possible moment.

### Q6 — What does "Apply retention" mean?

**Delete backup copies that have aged out, so the backup store does not grow forever.** The rule (decision D4):

- Keep **every daily copy for 30 days**.
- Additionally keep **Sunday copies for 12 weeks**.
- Delete everything older.

So at any moment you have roughly a month of day-by-day granularity plus a quarter of week-by-week history. The button just runs that rule immediately; normally it runs itself at 03:00, deliberately **two hours after** the nightly backup — pruning before the night's new copy has landed would delete the old copy the failed new one was supposed to replace.

Two things it does **not** do: it does not touch the live data (it only deletes backup files), and it does not currently prune the WAL archive or the media copies — see F2 in §7.

### Q7 — There is no restore button per tenant. Does restore functionality exist for the database and for media?

> **Superseded on 2026-09-30.** Both restores now have a console button — see
> §10, which records the decision, the safeguards and what the buttons still
> do *not* do. The rest of this answer describes the command-line paths, which
> remain the fuller surface (point-in-time, single document, `--force`).

**Database: yes** — originally command line only; now also a console button.

| Path | Available as | Touches the live tenant? |
|---|---|---|
| Drill (restore to a throwaway copy) | ✅ Button: "Run drill" / per-tenant "Drill", plus a monthly job | No |
| Real recovery to a named database | ⛔ No button. Command only: `npm run db:restore:drill -- --slug=acme --into=tenant_acme_recovered --i-am-recovering` | Yes — by explicit intent |
| Point-in-time recovery | Postgres procedure using `scripts/db/wal-restore.js` | Yes |

The absence of the button is a decision, not an omission: a console button that can overwrite a live tenant's database is a button that will eventually be clicked on the wrong row, and its existence would make the monthly automated drill unacceptably risky to schedule. The guard is in the service itself, not just in the UI — any target database not named `praxis_drill_*` is refused unless the caller explicitly opts in.

What is genuinely **missing** on the database side is the *last mile*: the command hands you a restored database and stops. Re-pointing the tenant registry at it, re-issuing credentials, running outstanding migrations and cutting over are undocumented (F7).

**Media: yes, as of this sweep (§7, fix 3) — command line only, matching the database.**

```
npm run db:objects:restore -- --slug=acme --dry-run        # what would happen
npm run db:objects:restore -- --slug=acme                  # restore what is missing
npm run db:objects:restore -- --slug=acme --doc=<id>       # just one document
npm run db:objects:restore -- --slug=acme --force          # overwrite corrupt live files
```

It never overwrites a surviving file unless forced, verifies each file's hash before writing, and records the run so a document that is missing from the backup too becomes an alert rather than a surprise. Still open (item D in §7): the monthly rehearsal does not yet exercise a document restore, so this path is tested but not *rehearsed* — which is a weaker claim than the database side can make.

### Q8 — Is there rclone functionality?

**No, and it was a deliberate rejection.** `INFRASTRUCTURE_PLAN.md` §3.2 (WS-B2) proposed `rclone sync` for the object backup; the implementation declined it and the reasoning is written into the top of `object-backup.service.js`:

- no external binary to install, version-pin and keep present in every container the worker runs in;
- it works identically whether storage is local or S3, whereas an rclone invocation needs a different remote spec per driver;
- it is testable without a filesystem or a bucket — which is what allowed the "deleting from primary must not delete offsite" property to be *asserted in a test* rather than assumed.

The trade is stated honestly in the same comment: the in-process version is a **serial** list-and-copy, O(number of objects), where rclone would parallelise and resume. If the object store outgrows it, the intended move is to swap the body of `syncObjects` for an rclone exec — the `backup_run` bookkeeping around it does not change. The same reasoning was applied again, harder, to WAL archiving when `pgBackRest` and `wal-g` were declined (`scripts/db/wal-archive.js` header).

The only occurrences of the word "rclone" in the repo are these three comments explaining why it is not used.

---

## 9. "Why not rclone?" — the answer for the lead

Asked directly: **would it work, and do we need it?**

### Would it work? Yes, for one half of the job.

rclone is a very good bulk file copier. It would happily mirror the document store to a second bucket, in parallel, with resume — and it would be faster at that than what we do now.

What it would **not** do:

- **The database backups don't need it.** Each tenant's dump is streamed straight from Postgres to the offsite bucket as it is produced. There is no local copy for rclone to come along and sync afterwards; inserting one would mean writing gigabytes to the host's disk first, which is slower and puts the backup on the very machine whose loss we are insuring against.
- **The change log (WAL) can't use it.** Postgres runs one command per segment and treats "command succeeded" as "this segment is safe". Handing that to a background sync would mean Postgres marking segments safe while they were still sitting on the local disk — the archive would look healthy right up to the moment the host died, taking the newest and most valuable segments with it.

So the honest scope is: rclone could replace the nightly **document** copy. Nothing else.

### Do we need it? Not now — and the current version buys something rclone can't.

**The speed argument doesn't bite yet.** The copy is incremental: it skips anything already offsite, so a normal night only moves the day's new files. It would need to be thousands of new documents per night before the nightly window became tight. Our own signal for when that changes already exists — the object sync's duration is recorded on every run, so "this is taking too long" is a number on the screen, not a guess.

**The thing we'd lose is the important part.** rclone copies *what is in the bucket*. Our version copies *what the database says should exist* — and the difference between those two lists is the entire value of the integrity check:

- a file in storage with no database row is junk;
- a **database row with no file is a document the app will offer a user and fail to produce** — silent, invisible until someone clicks it, and the single worst state in this system.

rclone can only ever find the first kind. A blind mirror would have copied our chat media problem straight past us; the database-driven version is what surfaced it (finding M1). It is also what makes the restore safe — restoring *by row* is how we know which files belong, can verify each one's fingerprint before writing, and can refuse to overwrite a surviving file.

**Two smaller practical points:** rclone is another binary to install, pin and keep present in every container, and it needs a different remote configuration per storage backend — whereas our copier works unchanged whether storage is a local folder or S3, and can be tested without either.

### The recommendation

**Stay as we are, and treat it as a reviewable decision rather than a closed one.** If the nightly document copy starts running long, the answer isn't to abandon the approach — it's a hybrid:

- **rclone for the bulk move** (parallel, resumable),
- **our database-driven reconciliation kept on top** as the verification and restore path.

That keeps the speed and the honesty. The trigger to revisit: the object sync failing to finish inside its nightly window, or a full-tenant document restore taking longer than the one-hour recovery target. Both are already measured.

*(For completeness: the same reasoning was applied, harder, to `pgBackRest` and `wal-g` for the change-log archive. Same conclusion, same recorded trigger — if the archive starts falling behind, the lag figure on the screen is the signal, and the bucket layout is deliberately unchanged so swapping the tool in later doesn't invalidate anything already stored.)*

---

## 10. The restore button — shipped

**Decision: option 3.** Both restores now have a button in Platform Console →
Ops → Backup & restore. I argued against the database one; the call was made to
add it, so it is built with every safeguard I said I would insist on, and this
section records what those are so the reasoning survives the people involved.

### What is on screen now

| Action | Where | Capability | Touches live data? |
|---|---|---|---|
| Rehearse a restore (throwaway copy) | "Run drill" / per-tenant "Drill" | `ops.operate` | No |
| Copy documents offsite / check them | "Sync" / "Scan" | `ops.operate` | No |
| **Restore a tenant's database** | **"Restore…" on the tenant row** | **`ops.restore`** | Creates a new database; live one untouched |
| **Restore a tenant's documents** | **"Restore…" in Object storage** | **`ops.restore`** | Writes back missing files only |

### The safeguards, and why each one is there

**A new capability, `ops.restore` (migration 0112).** Not folded into
`ops.operate`. Everything under `ops.operate` is *incapable* of touching live
tenant data, and that is precisely what makes an unattended monthly drill safe
to schedule. The Restore button sits next to the Drill button; the permissions
must not be the same one. It is granted to Root Admin only and can be handed to
another role deliberately from the Roles screen.

**The database restore never overwrites the live database.** There is no
destination parameter in the API at all — the server names a new database
(`tenant_<slug>_recovered_<timestamp>`) and restores into that. The tenant keeps
being served by its current database, so the button is *reversible*: if the
restore turns out to be the wrong call, nothing was lost by trying it.

**It says it is step 2 of 8.** The dialog, and the response the console shows
afterwards, both state that parking the tenant, re-pointing the registry,
re-issuing credentials and the pooler, running missed migrations, restoring
documents and verifying are still manual — runbook §4.3a. A button that does
step 2 while looking like the whole recovery is worse than no button; this was
the strongest argument against it, and the answer is to refuse to imply it.

**The tenant name must be typed back.** Not an "Are you sure?" — the failure
worth guarding is recovering the *wrong tenant*, and nobody notices that until
someone's users report missing work. Typing the name makes the target something
the operator stated rather than something they landed on.

**Every recovery is audited before it starts.** `platform.platform_audit`,
action `tenant.restore.started`, with the actor, the tenant, the chosen dump
and the destination. Six weeks later the only question that matters is which
dump was chosen and by whom. A failure to write the audit row does not block
the restore — during an incident the recovery matters more than the bookkeeping,
and the failure is logged.

**The document restore always rehearses first.** The dialog runs a dry run and
shows the numbers — how many documents are on record, how many would be written
back, how many are already present and will be left alone, and how many are in
neither place and therefore cannot be recovered at all — before the real button
becomes available. `--force` (overwriting files that survived) is **not**
reachable from HTTP: a surviving file is never older than the backup, so
overwriting can only lose work. That stays a command-line decision made by
someone who has read why.

### What the buttons still do *not* do

- Point-in-time recovery (WAL replay) — command line and Postgres procedure.
- Restoring a single document — `--doc=<id>` on the CLI.
- Overwriting a corrupt surviving file — `--force` on the CLI.
- Cutting a tenant over to a restored database. Deliberate: that is the step
  that makes a recovery visible to users, and it is eight steps of runbook, not
  one click.

### Where this is in the code

| Piece | Path |
|---|---|
| Capability | `migrations/platform/0112_ops_restore_capability.sql`, `src/middleware/platform-auth.js` |
| Routes | `src/modules/platform/ops/ops.routes.js` — `POST /ops/restore/:slug`, `POST /ops/objects/:slug/restore` |
| Request shapes | `src/modules/platform/ops/ops.validator.js` — `restoreRun`, `objectRestoreRun` |
| Handlers + audit | `src/modules/platform/ops/ops.controller.js` — `restoreRun`, `objectRestore` |
| Dialogs | `platform-console/src/features/ops/OpsRestoreModal.tsx` |
| Buttons | `platform-console/src/features/ops/OpsBackups.tsx` |
| Client | `platform-console/src/lib/ops-api.ts` — `canRestore`, `restoreDatabase`, `restoreObjects` |
| Tests | `tests/unit/ops-routes.test.js` — "recovery routes (ops.restore)", 8 tests |
