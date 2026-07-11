# Module Depth Audit — how deep is each module, really?

Triggered by the Smart Comms case (it was shipped shallow, then rebuilt to full
depth). This measures every module's surface objectively — HTTP endpoints, service
size, and whether it carries domain rules — to find any others that are thin
relative to what they should do.

Method: a script counts route endpoints + service LOC + presence of a `.rules.js`
per module, sorted thinnest-first, then the suspects are read against the PRD.

## Verdict

**Only one module was genuinely shallow-and-wrong in scope: `notification`** —
now fixed. The Phase 0–4 core is substantive: `app_user` (387 svc LOC + Argon2 +
2FA + lifecycle), `journal_entry` (164, OHADA engine), `workflow` (153, full
designer), `smartcomm` (150, rebuilt), `ai/governance` (148), `final_invoice`
(152, lifecycle), `smart_receivables` (112), `supplier_invoice` (102, 3-way
match), `quotation` (119), `cash_request` (117), `tax_jurisdiction` (106),
`asset` (107), `proposal` (101), `regie` (100) — all carry lifecycle/rules and
real behaviour, not CRUD.

## Findings by bucket

### Fixed this pass
- **`notification`** — was pure generic `makeService`, and (per its own code
  comment) `list()` returned EVERY tenant notification, not the caller's — a
  cross-user data-exposure bug. Rebuilt: self-scoped inbox (`GET /`,
  `/unread-count`, `/:id/read`, `/read-all`), reads/marks only the caller's rows,
  no create/delete via API (rows are event-engine-written). SQL in repo.

### Thin but adequate (read-only aggregators — by design)
- **`dashboard`** (`GET /kpis`) and **`workspace`** (`GET /` → my approvals +
  recent activity + unread) are small because they're personal read surfaces that
  delegate to a KPI/aggregation repo. Functional. The PRD's "many interactive
  dashboards, AI on every dashboard" is served by **MOD-63 report** (report
  registry + chat-on-dashboards) + the frontend, not by fattening these.
- **`ai/assistant`** (23 LOC) is a deliberate thin wrapper over the orchestrator
  (the depth lives in `services/ai/*`).
- **`catalogue`**, **`branding`** — platform read/config surfaces; appropriately
  small.

### Known dead (already tracked, retained)
- **`ai/ai.routes.js`** — `// DEPRECATED`, `module.exports = {}`, not mounted.
  Counts as 0/0. Superseded by `ai/assistant`.

### Phase-3 (HR / WMS / Fleet / Assets) — IN SCOPE (P0–P4 = phases 0,1,2,3,4)
Correction: an earlier draft wrongly called Phase 3 "out of scope." It is in
scope, and on inspection its modules **do implement their documented domains** —
they are lean "hybrid" modules (generic CRUD for boilerplate + hand-written
domain methods), not shallow CRUD:
- **`payroll` (MOD-17)** — the deepest domain logic after the OHADA ledger: full
  Cameroon statutory computation (`payroll.rules.js`): CNPS pension 4.2% ee+er
  with 750k ceiling, CNPS family 7% er, injury 1.75% er (risk-class overridable),
  CFC 1%/1.5%, 30% frais professionnels, progressive IRPP barème, CAC 10% surtax
  — `createRun` → `compute` payslips → `setStatus` → post to GL. Real KB §9.
- **`attendance`** clock-in/clock-out (guarded, employee-integrity-checked).
- **`leave_allowance`** REQUESTED→decide (approve/reject) request workflow.
- **`inventory`** stock `move` (in/out/transfer) + `listMovements` + state.
- **`outbound`** picking with `addLine`/`setLineFlags`/`setStatus`; **`inbound`** QA.
- **`vacancy`** recruitment pipeline (`addApplicant`/`setApplicantStatus`).
- **`training`** sessions + attendee rosters; **`hr_contract`** lifecycle.
- **`work_order`/`fleet_dispatch`/`incident`/`equipment`** lifecycle `setStatus`.
- **`asset` (MOD-54)** acquisition→depreciation→disposal (rules, 107 LOC).
- `vehicle`, `driver`, `vehicle_compliance`, `fuel_log`, `cycle_count`,
  `warehouse_location`, `appraisal`, `sop_onboarding`, `talent_pool` — real.

They are leaner than the fully-decked Smart Comms rebuild (fewer secondary
features), but every one covers its core documented flow. Depth here is real, not
a regression. If a specific Phase-3 module should match Smart Comms' breadth,
PRD-audit it individually.

## How to keep this honest
Depth ≠ line count, but line count + endpoint count + rules-presence is a good
smell test. The rule going forward (added to intake): before shipping a module,
check the PRD/kickoff for the intended feature surface — Smart Comms failed
precisely because the base schema was minimal and the docs' depth wasn't
consulted. The Smart Comms rebuild (migration `0430` + 37 repo fns) is the
reference bar for a "portal-grade" module.

## Deep-dive candidates if you want more depth later
- `dashboard` — could gain configurable tiles (the `dashboard_tile` table exists
  and MOD-63 already manages tiles; wire a per-role default dashboard).
- Phase-3 HR/WMS/Fleet — build to the same lifecycle depth as the finance/sales
  modules when Phase 3 is scheduled.
