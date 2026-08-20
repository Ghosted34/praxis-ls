# Clock-in revamp — engineering guide

**Status:** draft for implementation. **No application code in this document.**  
**Date:** 2026-08-19  
**Surfaces in scope:** title-bar / FAB punch, My HR, Human capital → Attendance, employee 360 attendance tab, devices, worksites, reconciliation, weekly queries, maps, export.

This is the senior-engineer audit plus the locked product decisions from ten questions. Implementation is **three large PRs**. Nothing in those PRs should ship a half-calendar or a second source of “is this a working day?”.

---

## 1. What exists today (audit)

### 1.1 Surfaces

| Surface | Path / home | What it actually does | Gaps vs “best ever” |
|---|---|---|---|
| Title-bar chip | `ClockPunchChip` in chrome | One tap clock in/out, GPS then punch, names new device once | No persistent location permission UX; silent until after a failed fix; no “restore location” wizard |
| Mobile FAB | `ClockPunch` in floating cluster | Same hook, different chrome | Same GPS gaps |
| Quick actions | desktop menu | Same `useClockPunch` | Hidden one click; not the state surface |
| HR Attendance | `/hr` → Attendance | **One calendar day** of punches + provisional absences + worksites + devices. Separate chip for **reconciled days** (month window, waive/uphold) | No 7d / month / quarter / year / custom on punches; no employee multi-select; no KPI strip; no heatmap; no download; no map of punches; worksites/devices dumped under the day log |
| Reconciled days | same page, second view | Window + charged-only + waive | Window capped at **92 days** in the validator; no compare set; no department rollup |
| My HR | `/my-hr` | Queries, sanctions, reviews, appraisals, leave, payslips, contracts | **Zero attendance history, zero KPIs, zero download** |
| Employee 360 | `/hr` → Employees | Punch list (in/out/late) for the selected person | No days-off overlay, no KPIs, no map, no range |
| Operations map | Control Tower `ShipmentMap` | SVG world projection of **lanes/orders**, not Geoapify tiles | Punches are not a layer; no permission filter for HR vs ops |

### 1.2 Backend (MOD-14)

**Routes that matter** (`src/modules/hr/attendance/attendance.routes.js`):

- Self: `GET /open`, `POST /clock-in`, `POST /clock-out`, `GET /days/mine`, `PATCH /devices/:id/name`
- HR: `GET /`, `GET /absence`, `GET /days`, `POST /days/:id/justify`, `POST /reconcile`
- Devices: `GET|POST /devices`, `PATCH /devices/:id`
- Worksites: `GET /place-search` (Geoapify, edit grant), `GET|POST /work-sites`, `PATCH /work-sites/:id`

**There is no** analytics endpoint, **no** export, **no** punch range (`from`/`to` on the log — only a single `date` or `employee_id`), **no** multi-employee filter, **no** weekly summary query job.

**Policies (settings):**

- `hr.geofence` = `off | warn | block` (default **warn**). Punch is accepted without GPS under warn; `within_geofence` is `null`.
- `hr.device_policy` = `off | warn | block` (default **off**). Devices still **register** on every punch; `off` means “do not judge”.
- `hr.attendance_policy` = `{ work_start, grace_minutes }` + `hr.timezone` (default Africa/Douala).
- `hr.weekend_days` + `employee.work_days` + `public_holiday` drive reconciliation.

**Clock-in path is already strong:**

- GPS optional at the client; server owns block/warn.
- Device upsert happens **before** a block refusal so the queue fills.
- Late punch raises a **same-day** auto-query (`attendance.query` upsert on `(employee, work_date, rule)`); reconciler **adopts** it and must not reopen `status` / `response`.
- Lateness uses workplace timezone (`attendance.rules.wallClock`), not the host clock.

**Reconciler** writes one `attendance_day` per employee per date: `PRESENT | LATE | ABSENT | ON_LEAVE | HOLIDAY | WEEKEND | OFF`. Leave beats calendar beats punch. Waivers keep the frozen deduction.

### 1.3 The calendar split (this is the load-bearing bug)

Attendance does **not** read the corporate **working calendar**.

| Source | Used by | Fields |
|---|---|---|
| `working_calendar` + `_day` + `_holiday` | Milestone engine, entity Master Data tab | Per-**entity** timezone, open weekdays + **opens_at/closes_at**, holidays (FR/EN, recurring vs movable) |
| `employee.work_days` + `expected_start_time` + `grace_minutes` | Attendance reconcile | Optional per-person weekday array; else tenant `hr.weekend_days` |
| `public_holiday` | Attendance + leave | Tenant-wide holidays, **not** the entity calendar |

A Douala yard on Mon–Sat 07:30–17:00 and an N’Djamena office on Sun–Thu will **charge absence on the wrong days** if we only honour `hr.weekend_days`. The revamp **must** resolve expected days in this order:

1. Employee override (`work_days`, `expected_start_time`, `grace_minutes`) when set.
2. Else the **entity** working calendar (inherit tenant default the same way milestones do).
3. Else tenant `hr.weekend_days` + `hr.attendance_policy` + `public_holiday`.

Holidays: union of entity `working_calendar_holiday` and tenant `public_holiday` unless the entity calendar is explicit and we decide entity-only (PR1 locks this in code comments + tests). **Recommendation:** entity holidays win when the entity has its own calendar; inherited calendars still union tenant public holidays so a national day is not missed.

Expected start for lateness: prefer `employee.expected_start_time`, else that weekday’s `opens_at` on the entity calendar, else `hr.attendance_policy.work_start`.

Timezone: prefer entity calendar timezone, else `hr.timezone`.

### 1.4 Other defects / risks

- **Validator window 92 days** — year view and “past year” download are illegal today.
- **`list` date filter** uses `clock_in_at::date` (UTC date). Reconciler already avoided this; the **log** still has the UTC-midnight bug.
- **No GPS** is visually a mute “No fix” pill — product wants **stronger than warn-friendly**.
- Blocked devices are **terminal** (re-register). Keep that; do not silently un-revoke.
- Geoapify place search is **quota-sensitive** (debounce + 3-char min already). Reverse geocode on every punch is best-effort.
- Punch map ≠ Control Tower map. Control Tower is an SVG lane model; Geoapify is used for **place search / reverse geocode**. “Same map as orders” means a **permissioned layer**, not dumping GPS into the world projection without RBAC.

---

## 2. Locked product decisions (10 questions)

| # | Decision |
|---|---|
| 1 | **Three homes, all first-class:** title-bar punch, **My HR** (everything concerning you), **Human capital → Attendance** (team). |
| 2 | **Always allow the punch.** Flag off-site and no-GPS **more loudly than today’s warn**. Weekly system queries summarise lateness. |
| 3 | Location: **wizard + PWA persist + recovery** when permission is lost. Fallback does **not** invent a location. |
| 4 | Download: **CSV + Excel (exceljs house style) + payroll-ready columns** (late mins, OT if we have clock-out, absences, deduction, waived, on-site, device). |
| 5 | Analytics v1 is **full:** KPIs, trends, heatmap, department rollup, **selected employee set**. |
| 6 | Devices stay **PENDING → TRUSTED / REVOKED**. Overlay **working calendar + leave** on the same attendance view. |
| 7 | Weekly auto-query: **employee only**, severity **WARNING**, **one query per person per completed week**. Not to manager/HR as extra queries. |
| 8 | Map: **same family as operations orders**, but **RBAC-gated**. Unauthorised users never see other people’s pins. Own pins always visible to the employee. |
| 9 | Lost GPS: employee **can still punch**; row is **flagged no-GPS** until permission is restored. Not a manager-approval gate. |
| 10 | Working days come from the **entity working calendar + employee overrides**. Split delivery into **three large PRs**. This document is the contract. |

Non-goals for the three PRs: changing payroll math except to consume the unified calendar; rewriting Control Tower projection; singing/PWA install store listing; relaxing device revocation.

---

## 3. Target experience

### 3.1 Punch (every authenticated user with or without an employee)

- Always visible in the title bar (desktop `sm+`) and FAB (touch).
- State in the accessible name: on the clock vs not.
- **Location permission:**
  - On first punch, request high-accuracy fix; if granted, keep a `watchPosition` / Permissions API listener so we know when it is revoked.
  - If denied / unavailable: punch still goes through **without coords**; chip shows a **bad** tone: “Clocked in · no location”.
  - A **recover panel** (not a blocking modal on the first tap): why we need it, OS/browser steps, Retry, “Install the app” (existing PWA banner), and “I’ll restore later”.
  - Never spoof coordinates. Never store a last-known fix as this punch’s location.
- Off-site: “Clocked in · off-site” (bad). Distinct from no location.
- New device: name offer **beside** a completed punch (unchanged).
- Unlinked user: clock visible, tap explains, no API write.

### 3.2 My HR — My attendance

New first section (or tab) on My HR:

- Period chips: **7 days / month / quarter / year / custom**.
- KPI row: punctuality %, hours worked (from in/out), late count, minutes late, absences, on-site %, days off (leave + holiday + non-working).
- Trend spark / simple week bars (late vs present).
- Heatmap of expected working days in the window (calendar of the **employee’s entity**).
- Table of days + punches, leave and OFF/HOLIDAY visible as first-class rows (not missing punches).
- Own map pins only.
- Download CSV / XLSX of **self only**.
- Open weekly WARNING queries appear in the existing Queries list (no second inbox).

### 3.3 HR Attendance command centre

Tabs (replace “Today | Reconciled” chips):

1. **Today** — live log + provisional “not in yet” (keep honesty about unreconciled today).
2. **History & analytics** — period + multi-select employees + department filter; KPI strip; heatmap; compare table; export CSV/XLSX of the **selected set** (or all if none selected and caller has view).
3. **Map** — punches + worksite geofences; optional overlay of orders the viewer is allowed to see.
4. **Devices** — existing queue (pending first).
5. **Worksites** — existing create/search/here.

Waive / uphold stays on history rows that have deductions.

Employee 360 Attendance tab reuses the same history widget scoped to one id.

### 3.4 Weekly lateness query

After the week **closes** (Monday 00:00 in the entity/tenant zone, covering the previous Mon–Sun **expected working days only**):

- If the employee had ≥1 LATE reconciled day that week and none waived-all:
  - Upsert **one** query: subject like `Weekly lateness — 2026-08-10 → 2026-08-16`.
  - Body: count of late days, total minutes, list of dates, “please explain the pattern”.
  - Severity **WARNING**, source `WEEKLY`.
  - **Must not** collide with the daily `(employee, work_date, rule)` unique index. Use `work_date = week_end` and `hr_rule_id` null **or** a dedicated weekly rule / `source = WEEKLY` with a partial unique `(employee_id, work_date) WHERE source = 'WEEKLY'`.
- Do **not** email/query the manager or HR. They already have analytics.
- Never fail reconciliation if the weekly writer throws.

### 3.5 Export columns (payroll-ready)

One sheet **Days** and one **Punches** (XLSX). CSV is Days (default) or Punches via `sheet=`.

Days: employee, department, entity, work_date, weekday, expected?, status, expected_start, first_in, last_out, hours, minutes_late, on_site, geo_label, device_label, device_trusted, deduction, waived, justification, leave_type, rule_code.

Punches: employee, clock_in, clock_out, lat, lng, within_geofence, geo_label, distance_m, device, late flag.

Window: **up to 366 days**. Pagination server-side for the interactive table; export is a single file, hard cap e.g. 20k rows.

### 3.6 Map + permissions

- **Employee:** own punch points only.
- **MOD-14 view:** team punches for employees they can already list (same as `/attendance`).
- **Operations map overlay:** only if the user also has the Control Tower / operations view grant. Attendance-only HR must not see commercial lanes. Ops-only users must not see HR pins.
- Worksites always drawn for MOD-14 view.
- Geoapify: reverse geocode and worksite search stay as today; static/preview tiles only if the platform key is present — degrade to lat/lng + OSM link.

---

## 4. Architecture

```
                    ┌─────────────────────────────────────┐
                    │  resolveExpectedDay(employee, date) │
                    │  employee override → entity cal →   │
                    │  tenant weekend + public_holiday    │
                    └──────────────┬──────────────────────┘
                                   │
     clock-in ──► attendance_log   │
         │                         ▼
         │              attendance_day (reconcile)
         │                         │
         ├── daily auto-query      ├── weekly WARNING (employee)
         └── device upsert         └── analytics / export / heatmap
```

**New modules (names):**

- `attendance.calendar.js` — resolve expected day / hours / timezone (thin wrapper over `corporate_entity.calendar` + employee columns). **Pure decisions in `attendance.rules` stay pure;** I/O lives here.
- `attendance.analytics.js` — summarize days + punches (pure, unit-tested).
- `attendance.export.js` — CSV + Excel via `src/services/spreadsheet` (`resolveContext` + `buildWorkbook` / `buildCsv`): branded, currency-aware, injection-safe. Never a private ExcelJS writer.
- `attendance.weekly.js` — compose + upsert weekly query.

**API additions (all behind existing MOD-14 grants except `/mine`):**

| Method | Path | Grant | Notes |
|---|---|---|---|
| GET | `/attendance/analytics` | view | `from,to,employee_ids[],department` |
| GET | `/attendance/analytics/mine` | none (linked employee) | self |
| GET | `/attendance/export` | view | `format=csv\|xlsx` |
| GET | `/attendance/export/mine` | self | self only |
| GET | `/attendance` | view | add `from,to` (local zone), `employee_ids` |
| GET | `/attendance/punches/mine` | self | range |
| GET | `/attendance/map` | view | punches + sites; strip others without grant |
| POST | `/attendance/weekly-summaries` | edit | idempotent backfill / run now |

Raise day-window max from 92 → **366**. Keep a refine so `to >= from`.

Fix log date predicate: compare `clock_in_at` against `[local midnight, next midnight)` in the resolved timezone, **not** `::date`.

---

## 5. Three large PRs

Each PR is independently reviewable, migrates forward-only, and must be **green** (unit + the attendance client tests) before the next starts.

### PR 1 — Calendar truth + punch integrity  
**Theme:** one definition of a working day; a punch that always records and honestly flags location/device.

**Why first:** analytics, weekly queries, heatmaps, and payroll-ready export are lies if Saturday is “absent” for a Mon–Sat yard.

**Backend**

- Add `attendance.calendar.js` resolving entity working calendar (reuse `corporate_entity.calendar` read path, including **inherited tenant default**).
- Change `reconcileDate` to use that resolver for `is_working_day`, holiday, timezone, and default expected start. Keep employee `work_days` / `expected_start_time` / `grace_minutes` as overrides.
- Daily rate working-days-in-month must use the **same** resolver (not only `hr.weekend_days`).
- Log list: range + timezone-safe day filter.
- Location flags: persist `location_source = gps | none`; treat `within_geofence is null` as **no GPS** in API decoration (`location_status: on_site | off_site | no_gps`).
- Geofence policy stays allow-on-warn; **do not** switch tenant default to block.
- Client `getFix` + Permissions API helper; recover wizard on chip/FAB; punch still sent without coords.
- Stronger pills: No GPS and Off-site use `bad` / `warn` with copy that cannot be confused.

**Frontend**

- Recover-location panel + PWA hint (reuse install banner, do not fork).
- HR Today: show location_status loudly; keep provisional absence copy.

**Tests**

- Calendar resolver: inherited vs own entity; employee override beats entity; holiday vs leave order unchanged.
- Reconcile: Mon–Sat entity does not mark Saturday `WEEKEND`.
- Clock chip tests still punch without GPS and report “no location”.
- New tests for permission helper (denied vs granted).

**Out of PR 1:** My HR history, export, weekly query, map overlay, multi-select KPIs.

**Migration:** none if columns exist; only add `location_source` if we refuse to overload `within_geofence`. Prefer a real column over another three-valued comment.

---

### PR 2 — My HR + HR analytics, filters, export  

**Theme:** every user sees their attendance; HR sees the set they pick; both can download payroll-shaped files.

**Backend**

- `daysFor` accepts `employeeIds[]` (cap 50).
- Analytics summarizer (pure): punctuality, hours, late, absent, on-site %, off/holiday/leave counts, department rollup, per-employee compare rows, heatmap cells keyed by date.
- Endpoints: analytics + export (+ `/mine`).
- Validator window 366 days.
- Export via existing workbook toolkit (Maroon header). Filename `attendance-{from}-{to}.xlsx`.

**Frontend**

- Shared `AttendanceHistory` widget (period chips, KPI row, heatmap, table, download).
- Mount on **My HR** (self) and **HR Attendance → History** (multi-select + department).
- Employee 360 Attendance tab uses the same widget.
- Reconciled waive/uphold remains on HR history rows.

**Tests**

- Summarizer fixtures (mixed statuses, waived days excluded from charged totals, hours from in/out).
- Export column contract (keys stable for payroll).
- Period helper: 7d / month / quarter / year / custom bounds.

**Out of PR 2:** weekly query job, operations map layer.

---

### PR 3 — Weekly queries, map layer, devices + days overlay polish  

**Theme:** pattern queries, authorised maps, calendar visible next to punches.

**Backend**

- Weekly composer + upsert + unique index for `source = WEEKLY`.
- Hook after nightly reconcile (new step in `attendance-reconcile` **or** a sibling job Monday 00:30 tenant zone). Idempotent.
- `GET /attendance/map` returns punches + worksites; controller strips subjects the actor cannot see.
- Optional: attach `dossier_id` / open operations file **only** when both grants exist (join is best-effort; missing ops feature ⇒ attendance pins only).

**Frontend**

- Map tab: Geoapify/OSM pins for authorised punches; worksite circles; if ops grant, order lanes from existing map model **filtered**.
- Devices panel stays a queue; show last geo label on the device row if cheap.
- Heatmap / day cells show leave / holiday / OFF from PR1 statuses.
- Manual HR correction punch (existing `POST /`) remains for edits; **not** required for no-GPS (decision 9).

**Tests**

- Weekly: one query per employee per week; skipped if no late days; does not clobber daily query; does not reset RESPONDED.
- Map payload: employee A cannot see B’s coordinates.
- Ops user without MOD-14 view gets lanes without HR pins.

---

## 6. Implementation rules (do not regress)

1. **Punch never fails because analytics/query/calendar lookup failed.** Catch, log, punch stands.
2. **Daily auto-query upsert remains the single writer** for same-day lateness. Weekly is a different source/index.
3. **Waive is `approve`, reconcile rerun is `edit`, self `/mine` needs no grant.**
4. **REVOKED stays terminal.**
5. **Do not use `clock_in_at::date`.** Local zone only.
6. **Do not hold a pooled connection across Geoapify HTTP** (place-search already outside `tenantDb`).
7. **Export is a report, not an unbounded page.** Cap rows; 366-day window.
8. **No spoofed GPS.** Flag `no_gps` instead.
9. **i18n:** new copy through existing `tr` / dict patterns used on HR screens.
10. **Reuse** `KpiRow`, `src/services/spreadsheet` (`resolveContext` + `buildWorkbook`), `corporate_entity.calendar`, `useClockPunch`, `composeQuery` style (pure text functions).

---

## 7. Test plan (minimum)

| Layer | Must prove |
|---|---|
| `attendance.rules` | Existing lateness/timezone/tier tests stay green |
| `attendance.calendar` | Entity Sat-open; inherited default; employee override; holiday |
| `attendance.analytics` | KPI math; waived excluded from deducted; compare set |
| `attendance.query` + weekly | Wording; no duplicate daily; weekly unique |
| Clock chip (vitest) | Punch without GPS; off-site; device_new once; unlinked user |
| History widget | Period chips change `from`/`to`; download hits `/mine` vs HR export |
| Map | Permission matrix (self / HR / ops / both / neither) |
| Reconcile job | Weekly hook does not fail the reconcile return value |

---

## 8. Rollout

1. Merge PR1 to `arena/01a01a93-praxis-ls` (or sequential PRs from this branch as agreed). Reconcile **one past week** in sandbox and compare Saturday/Sunday statuses before live.
2. PR2 can ship dark: endpoints unused until UI mounts; mount My HR first, then HR tab.
3. PR3 weekly job: run once with `POST /weekly-summaries` on sandbox; confirm no duplicate daily queries.
4. Feature flags: none required if PR1 calendar is correct; if calendar mismatch is scary, gate **only** “use entity calendar” behind `hr.use_entity_calendar` default **true** in new tenants, **true** after sandbox sign-off.

---

## 9. File touch list (expected)

**PR1:** `attendance.reconcile.js`, new `attendance.calendar.js`, `attendance.repo.js` (range), `attendance.service.js` (location_status), `attendance.rules.js` (only if expected-start-from-opens_at needs a pure helper), `clock-punch.tsx`, `hr-api.ts` (`getFix` + permission), `attendance.tsx` (pills), tests.

**PR2:** `attendance.analytics.js`, `attendance.export.js`, routes/controller/validator, `hr-api.ts`, new `attendance-history.tsx`, `my-hr.tsx`, `attendance.tsx`, `attendance-days.tsx` (compose or replace), `employee-360.tsx`, unit tests.

**PR3:** `attendance.weekly.js`, `attendance.query.js` (compose weekly), job handler, map route, map tab, devices copy, unique-index migration.

---

## 10. Open items that are *not* blockers

- Overtime definition (clock-out after `closes_at`) — include hours in export; OT column can be v1.1.
- Live “who is on site now” playback — not in the three PRs.
- Re-approving revoked devices — rejected; re-register remains.
- Manager fallback approval — rejected; self-flagged no-GPS instead.

When these three PRs land, clock-in, My HR, and HR attendance share one calendar, one punch, one query model, and one export contract.
