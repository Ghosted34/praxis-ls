# Clock-in revamp — completion audit

**Audited:** 2026-08-27 · **Auditor:** independent pass, no implementation work
**Contract audited against:** `doc/CLOCKIN_REVAMP_ENGINEERING_GUIDE.md` (2026-08-19)
**Verdict:** PR1 complete and merged. PR2 and PR3 not started. Programme ~33% delivered.

This is a completeness *and* performance audit: what the contract asked for, what
actually exists in the tree, and how the delivered work behaved on the way in.

---

## 1. Scoreboard

| PR | Theme | Status | Evidence |
|---|---|---|---|
| PR1 | Calendar truth + punch integrity | **Complete** ✅ | PR #232 merged 2026-08-19, + remediation `2d66784` |
| PR2 | My HR + HR analytics, filters, export | **Not started** ❌ | No module, route, validator change or widget exists |
| PR3 | Weekly queries, map layer, overlay polish | **Not started** ❌ | No module, route, migration or tab exists |

PR2 is the largest of the three by scope, so the remaining effort is well over
two-thirds of the programme.

---

## 2. PR1 — verified complete

Every line item in the guide's PR1 contract is present on `main`.

| Contract item (guide §5, PR1) | Status | Where |
|---|---|---|
| `attendance.calendar.js` resolving entity calendar incl. inherited default | ✅ | `src/modules/hr/attendance/attendance.calendar.js` |
| `reconcileDate` uses resolver for working day / holiday / tz / expected start | ✅ | `attendance.reconcile.js:100`, `:134` |
| Employee `work_days` / `expected_start_time` / `grace_minutes` still override | ✅ | `attendance.calendar.js` `decideExpected`, `source: 'employee'` |
| Daily-rate working-days-in-month uses the *same* resolver | ✅ | `attendance.reconcile.js:140` |
| Log list: range + timezone-safe day filter | ✅ | `attendance.repo.js:140` |
| Persist `location_source` (`gps` \| `none`) | ✅ | migration `migrations/tenant/10740_attendance_location_source.sql` |
| Expose `location_status` in API decoration | ✅ | `attendance.location.js`; `attendance.service.js:255`, `:466` |
| Geofence policy stays allow-on-warn (no default flip to block) | ✅ | unchanged |
| Client `getFix` + Permissions API helper | ✅ | `client/src/lib/geo-permission.ts` |
| Recover wizard on chip/FAB; punch still sent without coords | ✅ | `client/src/components/clock-punch.tsx:219`, `:430` |
| Stronger No-GPS / Off-site pills | ✅ | `attendance-site-pill.tsx`, `attendance.tsx` |
| Tests: calendar resolver, reconcile Sat-open, chip without GPS, permission helper | ✅ | 9 suites under `tests/unit/attendance-*` + client tests |

**Beyond spec, correctly:** the implementation added a fourth location state,
`unfenced` — GPS arrived but the tenant has placed no worksite to judge it
against. The guide's three-state model would have painted that as "No GPS",
which is precisely how a tenant learns to ignore the flag. Good judgement.

**Kill `clock_in_at::date`:** done. The two remaining grep hits are explanatory
comments recording why the pattern was removed, not live code.

---

## 3. PR1 performance findings

The substance of PR1 is good. The delivery was not clean, and the pattern is
worth carrying into PR2 and PR3.

**A crash shipped in the reviewed diff.** `clockIn` built its response as
`locationStatus({ ...row, location_source })` — object shorthand for an
identifier no scope in the function declares. Under `"use strict"` that is a
`ReferenceError` on **every punch**, not an edge case. The endpoint people are
paid through did not work at all.

**It was the second occurrence of the same failure on the same function.** The
remediation commit records an earlier comment above `repo.create` documenting a
prior break where "the endpoint had never once worked."

**Root cause is a test gap, not carelessness.** Nothing in `tests/` had ever
called `clockIn`. Coverage was carried by the linter. `2d66784` added
`tests/unit/attendance-clock-in.test.js`, which pins the returned punch, the
stored `location_source`, the open-shift refusal and the block-policy refusal;
reverting the fix turns three of its five cases red.

**Three further defects rode along in the same submission:**

- `locationSourceFromFix` was written, exported and unit-tested, then never
  called — `clockIn` re-derived the logic inline, so the tested code was not the
  running code.
- A dead branch in `locationStatus` (`refused`) that could never change an
  answer, plus an `eqeqeq` lint error.
- An unused i18n import in `attendance.tsx` (TS6133) that **failed docker-build**,
  and a botched edit that spliced a truncated duplicate line into a docblock.
- The client sat at 114 lint warnings against a `--max-warnings 112` budget.

All were fixed in `2d66784`, which returned the client to main's 111 baseline —
zero net warnings added by the feature.

**Read-across for PR2/PR3:** green-on-first-submit was not achievable here, and
three CI jobs were red with one hiding a crash. Budget an explicit verification
pass. The single highest-value rule: **every new endpoint needs a test that
actually invokes its service function and asserts on the payload** — not a
schema test, not a route-table test.

---

## 4. PR2 — not started

Nothing in the PR2 contract exists.

**Backend gaps**

| Required | State |
|---|---|
| `attendance.analytics.js` (pure summarizer) | Absent |
| `attendance.export.js` (CSV + XLSX) | Absent |
| `GET /attendance/analytics` | Absent from `attendance.routes.js` |
| `GET /attendance/analytics/mine` | Absent |
| `GET /attendance/export` | Absent |
| `GET /attendance/export/mine` | Absent |
| `GET /attendance/punches/mine` | Absent |
| `daysFor` accepts `employeeIds[]` (cap 50) | Absent — validator takes singular `employee_id` |
| Log list accepts `employee_ids` / `department` | Absent |
| Day window 92 → 366 | **Still capped at 92** in `attendance.validator.js` |

The 92-day cap is a live contradiction with the guide: year view and the
"past year" download are illegal against today's validator.

**Frontend gaps**

| Required | State |
|---|---|
| `attendance-history.tsx` shared widget | Does not exist |
| Mounted on My HR (self) | **My HR carries zero attendance content** — an employee can see nothing about their own attendance |
| Mounted on HR Attendance → History tab | Tabs are Today / Worksites / Devices only; no History, no Map |
| Employee 360 Attendance tab uses shared widget | Still a raw punch table via `api.listAttendance({ employee_id })` |

**Prerequisites already in place** — these do not need building:

- `src/services/spreadsheet/` (`context.js`, `build.js`, `csv.js`) — exactly the
  branded, currency-aware, injection-safe toolkit the guide mandates over a
  private ExcelJS writer.
- KPI components: `client/src/components/ui/kpi-tile.tsx`,
  `client/src/features/dashboard/components/kpi-strip.tsx`.
- Local-zone `from`/`to` range querying, delivered by PR1.
- `attendance.calendar.js` — the pure expected-working-day source that analytics
  and the heatmap must use rather than re-deriving weekends.

---

## 5. PR3 — not started

| Required | State |
|---|---|
| `attendance.weekly.js` composer + upsert | Absent |
| Partial unique index migration for `source = 'WEEKLY'` | Absent |
| Weekly hook after nightly reconcile | Absent — job infra exists (`src/jobs/handlers/attendance-reconcile.js`, `attendance-reconcile-scheduler.js`, registered in `workers.js:124-125`), the hook is not wired |
| `POST /attendance/weekly-summaries` | Absent |
| `GET /attendance/map` + RBAC stripping | Absent |
| Map tab (punches, worksite circles, optional ops overlay) | Absent |
| Devices/day-cell overlay polish | Absent |

---

## 6. Recommended sequence

**Start with PR2.** Reasons, in order:

1. **Largest user-visible hole.** My HR shows an employee nothing about their own
   attendance — decision #1 in the guide made My HR a first-class home, and it is
   empty.
2. **Carries the payroll-ready export**, the delivery-critical artefact.
3. **No reordering benefit.** PR3 depends on PR1's statuses, not on PR2. Taking
   PR3 first would not unblock anything and would leave the bigger gap open.

Guide §8 has PR2 shipping dark — endpoints can land before the UI mounts, then
My HR first, then the HR tab. That is a genuine parallelisation option if the
delivery date is tight.

---

## 7. Operational notes for implementers

- **Test runners are split.** Backend is Jest (`npx jest tests/unit/attendance-
  --no-coverage`). Client is Vitest (`npx vitest run`). Running attendance
  backend tests under Vitest fails with `jest is not defined` — that is the wrong
  runner, not a broken test.
- **Lint budget** is `--max-warnings 136` (`package.json`). PR1 had to be
  remediated for overrunning its budget; add zero net warnings.
- **`tsc` and the client build are gates.** An unused import failed docker-build
  on PR1.
- **Migration numbering:** highest tenant migration at audit time was `12744`.
  Numbering collisions have already forced one renumber commit on this repo
  (`c47108c`), so take the next free number at branch time rather than from this
  document.
- **CHANGELOG:** the house rule requires the Unreleased entry in the same PR.

---

## 8. Audit method

Static verification against the tree at `main`, plus git history for delivery
behaviour. Pure-module tests were executed (`attendance-calendar`,
`attendance-calendar-context`, `attendance-location`, `attendance-rules`,
`attendance-query`) — 47 passing. Four suites could not execute in the audit
container because `node_modules` was absent (`Cannot find module 'express'`);
that is an environment limitation, not a code failure, and those suites are
reported green in PR #232's own verification notes.
