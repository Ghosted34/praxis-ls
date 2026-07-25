# UI Depth Overhaul — HR & Employees, Fleet, Vehicles, Warehouse

**Status:** audit + plan for discussion.
**Problem in one line:** the backend modules carry real domain lifecycles, but the client wraps each in a generic `CrudResource` (list / create / edit / delete) — so the *actions* that make the system perform are missing, and edit/delete sit where a workflow belongs.

## The evidence

Every screen in the four focus areas is a `CrudResource` — the file headers say so verbatim ("full CRUD over the … endpoints via CrudResource"):

- **HR (10):** Employees, Payroll, Vacancies, Contracts, Appraisals, Attendance, Leave & allowances, SOPs, Trainings, Talent pool.
- **Fleet / Vehicles (7):** Vehicles, Vehicle compliance, Work orders, Dispatch, Fuel log, Driver licences, Incidents.
- **Warehouse / WMS (6):** Locations, Inventory, Inbound/GRN, Outbound, Equipment, Cycle counts.

23 screens. The backends behind them already expose lifecycle verbs (compute/post payroll, decide leave, clock-out, set-status, dispatch check-in/out, pick/pack, QA, discrepancy, advance) that the UI never surfaces.

## The principle — archetypes, not CRUD

Each screen should become the *shape of the work it supports*, not a table with an edit pencil. The archetypes we need:

- **Profile hub / 360** — an entity with sub-records + actions in tabs (Employee, Vehicle). We already have the pattern in the dossier 360° modal.
- **Workflow board / lifecycle detail** — a record with a status timeline and stage actions (Work order, Incident, Contract, Dispatch, Inbound, Outbound).
- **Kanban pipeline** — drag across stages (Vacancy applicants). Pattern exists in Sales.
- **Queue with decisions** — approve/reject rows (Leave requests, Cycle-count discrepancies).
- **Run workstation** — a batch you compute → review → post (Payroll).
- **Ledger + actions** — an append-only movement list with in/out/transfer actions (Inventory).
- **Count sheet** — expected vs counted lines with variance (Cycle count).
- **Time clock** — self-service clock in/out with geofence + map (Attendance).
- **Calendar / expiry board** — dated items with renew actions + alerts (Compliance, Driver licences).

## Reusable kit already in the repo

Leverage, don't reinvent: `DataList`/`Column`, `Modal`/`Field`/`Select`, `Pill`/`StatusPill`, `Segmented` + `HubTabs`, `KpiRow`/`KpiTile`, the Sales **Kanban**, the operations **360° modal**, `useResource`/`useList`, `AiActions`/`ScreenAi`. New shared blocks to build once and reuse: a **StatusTimeline/StepBar**, an **ActionBar** (context actions on a record), a **geolocation capture** hook, a small **map pin** (needs a tile provider decision), and a **line-editor grid** (for pick lists, count sheets, WO parts).

---

## Screen-by-screen matrix

Legend for priority: 🔴 high (core daily workflow, most value) · 🟠 medium · 🟡 later.

### HR & Employees

| Screen | Today | Should be | Key actions (backend already supports) | Pri |
|---|---|---|---|---|
| Employees | CRUD table | **Profile 360** — one employee with tabs: contract, payslips, attendance, appraisals, leave, documents; active/suspend | profile + related reads; `assertActive` lifecycle | 🟠 |
| Payroll | CRUD table | **Run workstation** — create run → Compute (roster payslips) → Submit → Approve → Validate (posts GL) → Disburse; payslip drill-down | `createRun` / `compute` / `setStatus` (SoD states) → GL post | 🔴 |
| Attendance | type-in datetimes | **Time clock** — Clock in/out with device GPS + geofence status + address; admin log with on-site badge | geofenced `clockIn`/`clockOut` (to build) | 🔴 |
| Leave & allowances | CRUD table | **Request queue** — submit request → Line-manager/HR Approve/Reject; balances | REQUESTED → decide (approve/reject) | 🔴 |
| Vacancies | CRUD table | **Recruitment kanban** — applicants across stages | `addApplicant` / `setApplicantStatus` | 🟠 |
| Contracts | CRUD table | **Contract lifecycle** — status timeline + renew/terminate + doc capture | contract `setStatus` | 🟠 |
| Appraisals | CRUD table | **Scorecard** — KPI scoring form + history | appraisal scoring | 🟡 |
| Trainings | CRUD table | **Session detail** — session + attendee roster (add/mark) | sessions + attendee rosters | 🟡 |
| SOPs / Onboarding | CRUD table | **Onboarding checklist** — steps per new hire | sop_onboarding steps | 🟡 |
| Talent pool | CRUD table | **Succession board** — readiness per role | talent pool | 🟡 |

### Fleet & Vehicles

| Screen | Today | Should be | Key actions | Pri |
|---|---|---|---|---|
| Vehicles | CRUD table | **Vehicle 360** — one vehicle with tabs: compliance, work orders, dispatch history, fuel/efficiency, incidents, documents | registry + related reads | 🔴 |
| Vehicle compliance | CRUD table | **Compliance/expiry board** — insurance/vignette/inspection with expiry alerts + Renew | compliance rules + expiry events | 🟠 |
| Work orders | CRUD table | **Work-order detail** — OPEN → IN_PROGRESS → DONE, parts (qty×unit_cost), total cost, dossier link | `setStatus` + parts | 🔴 |
| Dispatch | CRUD table | **Dispatch board** — assign driver+vehicle → Check-out (odometer) → Check-in (odometer, distance) | `setStatus` ASSIGNED→OUT→RETURNED | 🔴 |
| Fuel log | CRUD table | **Fuel capture + efficiency** — fill entry (odometer-guarded) + L/100km stats per vehicle | `create` + `efficiency` summary | 🟠 |
| Driver licences | CRUD table | **Driver profile** — licences/certs with expiry alerts + Renew | licence expiry | 🟠 |
| Incidents | CRUD table | **Incident workflow** — Report → Under review → Closed + claim | report → resolve `setStatus` | 🟠 |

### Warehouse / WMS

| Screen | Today | Should be | Key actions | Pri |
|---|---|---|---|---|
| Inventory | CRUD table | **Stock ledger + moves** — on-hand by item/location + In / Out / Transfer actions; movement history | stock `move` (in/out/transfer) + movements | 🔴 |
| Cycle counts | CRUD blob form | **Count sheet** — pick location → expected vs counted per item → variance → submit → discrepancy → adjust | count → `discrepancy_found` → inventory reconcile | 🔴 |
| Outbound | CRUD table | **Pick/pack workflow** — order → pick lines (addLine / mark picked/packed) → PICKING → PACKED → DISPATCHED | `addLine` / `setLineFlags` / `setStatus` | 🔴 |
| Inbound / GRN | CRUD table | **Receiving + QA** — receive lines → QA pass/fail → post GRN (feeds 3-way match) | receiving + QA change | 🟠 |
| Equipment | CRUD table | **Allocation board** — check-out / check-in, status (available/in-use/maintenance) | `setStatus` | 🟡 |
| Locations | CRUD table | **Location tree** — zones → bins; capacity/label | locations (+ label) | 🟡 |

---

## Cross-cutting things to fix while we're in here

- **Remove edit/delete where a reversal/transition belongs.** Accounting-connected and lifecycle rows should never show a raw delete; they get status transitions or reversals (mirror the ledger's immutability discipline).
- **Field-visibility / RBAC** — salaries, margins, cost rates must respect the server masks on these screens (already enforced server-side; the new UIs must not assume full data).
- **AI affordances** — keep the `ScreenAi`/`AiActions` gate on each rebuilt screen (per the Praxis AI gate rule).
- **Reference mock** — check the Lovable `v-<area>` section before building each area (per the FE conventions rule).

## Suggested sequence (most daily value first)

1. **Attendance time clock + geofence** (HR) — highest visible fix; unlocks the geolocation/map building blocks.
2. **Payroll run workstation** (HR) — deepest, highest-stakes lifecycle.
3. **Leave request queue** (HR).
4. **WMS: Inventory ledger + Cycle-count sheet + Outbound pick/pack** (the warehouse trio).
5. **Fleet: Dispatch board + Work-order detail + Vehicle 360**.
6. Remaining medium/low (compliance, drivers, incidents, vacancies, contracts, inbound; then the 🟡 tail).

Shared blocks (StatusTimeline, ActionBar, geolocation hook, line-editor grid, map pin) are built in step 1–4 and reused throughout.

## Open questions

- **Map tiles** — do we add a map library (Leaflet/MapLibre + a tile key) for the Time Clock pin and future maps, or start pin-less (coords + address only)? (No map lib is in the client today.)
- **Sequence** — agree the order above, or reprioritise (e.g. warehouse before payroll)?
- **Depth bar** — how far per screen for v1: the core workflow + actions, or full parity with the reference mock in one pass?
